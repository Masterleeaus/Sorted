import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createPrivateKey, type KeyObject } from "node:crypto";
import { compactVerify, decodeProtectedHeader, decodeJwt, jwtVerify, importSPKI } from "jose";
import {
  FORBIDDEN_LINK_CLAIMS,
  LinkAssertionError,
  createMemoryLinkNonceStore,
  generateLinkNonce,
  loadLinkSigningKey,
  signLinkAssertion,
  type LinkAssertionInput,
} from "../link-assertion";
import { CentralNotConfiguredError, readLinkConfig } from "../config";

// Generated per test run. No key material is committed.
const pair = generateKeyPairSync("ed25519");
const privateKey: KeyObject = pair.privateKey;
const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const NOW = 1_800_000_000;
const KID = "sorted-test-2026-11";

const input: LinkAssertionInput = {
  sub: "usr_abc123XYZ",
  org: "org_0a1b2c3d4e5f",
  lu: "lu_0123456789ab",
  la: "la_0123456789ab",
};

function options(overrides: Partial<Parameters<typeof signLinkAssertion>[1]> = {}) {
  return {
    issuer: "sorted",
    audience: "titan-central",
    keyId: KID,
    privateKey,
    nonceStore: createMemoryLinkNonceStore(() => NOW),
    now: () => NOW,
    ...overrides,
  };
}

async function sign(
  overrides: Partial<Parameters<typeof signLinkAssertion>[1]> = {},
  body: Partial<LinkAssertionInput> & Record<string, unknown> = {},
) {
  return signLinkAssertion({ ...input, ...body } as LinkAssertionInput, options(overrides));
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ name: "LinkAssertionError", code });
  await expect(promise).rejects.toBeInstanceOf(LinkAssertionError);
}

describe("link assertion signing (Central titan-link+jwt contract)", () => {
  it("round-trips: verifies with the public key and carries exactly the contract claims", async () => {
    const { token, nonce, iat, exp } = await sign();
    const publicKey = await importSPKI(publicKeyPem, "EdDSA");
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: "sorted",
      audience: "titan-central",
      algorithms: ["EdDSA"],
    });

    expect(Object.keys(payload).sort()).toEqual(
      ["aud", "exp", "iat", "iss", "la", "lu", "nonce", "org", "sub"].sort(),
    );
    expect(payload).toMatchObject({
      iss: "sorted",
      aud: "titan-central",
      sub: input.sub,
      org: input.org,
      lu: input.lu,
      la: input.la,
      nonce,
      iat,
      exp,
    });
  });

  it("uses an exact protected header: alg EdDSA, typ titan-link+jwt, kid only", async () => {
    const { token } = await sign();
    expect(decodeProtectedHeader(token)).toStrictEqual({
      alg: "EdDSA",
      typ: "titan-link+jwt",
      kid: KID,
    });
    expect(token.split(".")).toHaveLength(3);
  });

  it("verifies with Ed25519 and rejects a different key", async () => {
    const { token } = await sign();
    const other = generateKeyPairSync("ed25519").publicKey;
    await expect(compactVerify(token, other)).rejects.toThrow();
  });

  it("enforces exp - iat of at most 300 seconds", async () => {
    const ok = await sign({ lifetimeSeconds: 300 });
    expect(ok.exp - ok.iat).toBe(300);
    await expectCode(sign({ lifetimeSeconds: 301 }), "lifetime_exceeded");
    await expectCode(sign({ lifetimeSeconds: 0 }), "lifetime_exceeded");
    await expectCode(sign({ lifetimeSeconds: 1.5 }), "lifetime_exceeded");
  });

  it.each([...FORBIDDEN_LINK_CLAIMS])("refuses forbidden identity claim %s", async (claim) => {
    await expectCode(sign({}, { [claim]: "someone@example.com" }), "forbidden_claim");
  });

  it("refuses unknown claims outside the contract allowlist", async () => {
    await expectCode(sign({}, { role: "admin" }), "unknown_claim");
  });

  it("refuses identifiers that do not match the contract pattern, including emails", async () => {
    await expectCode(sign({}, { lu: "user@example.com" }), "invalid_identifier");
    await expectCode(sign({}, { la: "short" }), "invalid_identifier");
    await expectCode(sign({}, { org: "" }), "invalid_identifier");
  });

  it("requires a Central usr_ subject", async () => {
    await expectCode(sign({}, { sub: "abc123XYZ-user" }), "invalid_subject");
  });

  it("nonce: 128+ bits, 22 to 128 base64url characters, single use", async () => {
    const generated = generateLinkNonce();
    expect(generated).toMatch(/^[A-Za-z0-9_-]{22,128}$/);
    expect(Buffer.from(generated, "base64url").length).toBeGreaterThanOrEqual(16);

    await expectCode(sign({ nonceFactory: () => "a".repeat(21) }), "invalid_nonce");
    await expectCode(sign({ nonceFactory: () => "a".repeat(129) }), "invalid_nonce");
    const shortest = await sign({ nonceFactory: () => "a".repeat(22) });
    expect(shortest.nonce).toHaveLength(22);

    const store = createMemoryLinkNonceStore(() => NOW);
    const fixed = () => "Zm9vYmFyYmF6cXV4MTIzNDU2";
    await signLinkAssertion(input, options({ nonceStore: store, nonceFactory: fixed }));
    await expectCode(
      signLinkAssertion(input, options({ nonceStore: store, nonceFactory: fixed })),
      "nonce_reused",
    );
  });

  it("produces a different nonce for each assertion by default", async () => {
    const a = await sign({ nonceStore: createMemoryLinkNonceStore(() => NOW) });
    const b = await sign({ nonceStore: createMemoryLinkNonceStore(() => NOW) });
    expect(a.nonce).not.toBe(b.nonce);
    expect(decodeJwt(a.token).nonce).toBe(a.nonce);
  });
});

describe("link signing key and configuration", () => {
  it("names the missing variable instead of failing silently", () => {
    expect(() => readLinkConfig({})).toThrow(CentralNotConfiguredError);
    try {
      readLinkConfig({});
    } catch (error) {
      expect((error as CentralNotConfiguredError).variable).toBe("TITAN_LINK_ISSUER");
      expect((error as Error).message).toContain("not configured");
    }
  });

  it("loads an Ed25519 PKCS#8 key from env, accepting escaped newlines", async () => {
    const oneLine = privatePem.replace(/\n/g, "\\n");
    const key = await loadLinkSigningKey({ TITAN_LINK_PRIVATE_KEY: oneLine, TITAN_LINK_ISSUER: "sorted", TITAN_LINK_AUDIENCE: "titan-central", TITAN_LINK_KEY_ID: KID });
    expect(key.asymmetricKeyType).toBe("ed25519");
  });

  it("rejects a non-Ed25519 key", async () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const pem = rsa.export({ type: "pkcs8", format: "pem" }).toString();
    await expect(
      loadLinkSigningKey({ TITAN_LINK_PRIVATE_KEY: pem, TITAN_LINK_ISSUER: "sorted", TITAN_LINK_AUDIENCE: "titan-central", TITAN_LINK_KEY_ID: KID }),
    ).rejects.toMatchObject({ code: "invalid_key" });
  });

  it("fails with a clear error when the private key is unset", async () => {
    await expect(loadLinkSigningKey({})).rejects.toBeInstanceOf(CentralNotConfiguredError);
  });

  it("the parsed key is usable for signing", async () => {
    const key = createPrivateKey(privatePem);
    const { token } = await sign({ privateKey: key });
    expect(decodeProtectedHeader(token).kid).toBe(KID);
  });
});
