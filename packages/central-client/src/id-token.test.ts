import { createPublicKey } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CentralClientError } from "./errors";
import { createJwksClient, type KeyResolver } from "./jwks";
import { makeSigner, signToken, testConfig, TEST_CLIENT_ID, TEST_ISSUER, TEST_NONCE, validClaims } from "./test-helpers";
import { verifyIdToken } from "./id-token";
import type { FetchLike } from "./discovery";

const NOW = 1_800_000_000_000;
const signer = makeSigner("kid-1");
const signingKey = createPublicKey({ key: signer.publicJwk as never, format: "jwk" });
const keys: KeyResolver = {
  getKey: async (kid) => {
    if (kid !== signer.kid) throw new CentralClientError("unknown_kid", "signing key not found");
    return signingKey;
  },
};

async function verify(token: string, extra: Partial<Parameters<typeof verifyIdToken>[0]> = {}) {
  return verifyIdToken({ token, config: testConfig(), expectedNonce: TEST_NONCE, keys, now: NOW, ...extra });
}

async function expectReason(token: string, reason: string, extra: Partial<Parameters<typeof verifyIdToken>[0]> = {}) {
  await expect(verify(token, extra)).rejects.toThrow(reason);
}

describe("verifyIdToken", () => {
  it("accepts a correctly signed token and returns the verified subset", async () => {
    const token = signToken(signer, validClaims(NOW));
    const result = await verify(token);
    expect(result.sub).toBe("user-123");
    expect(result.iss).toBe(TEST_ISSUER);
    expect(result.aud).toEqual([TEST_CLIENT_ID]);
    expect(result.nonce).toBe(TEST_NONCE);
  });

  it("accepts an audience array when azp equals the client id", async () => {
    const token = signToken(signer, validClaims(NOW, { aud: [TEST_CLIENT_ID, "other"], azp: TEST_CLIENT_ID }));
    await expect(verify(token)).resolves.toMatchObject({ azp: TEST_CLIENT_ID });
  });

  it("rejects a multi-audience token without azp", async () => {
    await expectReason(signToken(signer, validClaims(NOW, { aud: [TEST_CLIENT_ID, "other"] })), "azp required");
  });

  it("rejects an azp that names a different client", async () => {
    await expectReason(signToken(signer, validClaims(NOW, { azp: "someone-else" })), "azp mismatch");
  });

  it("rejects the wrong audience", async () => {
    await expectReason(signToken(signer, validClaims(NOW, { aud: "other-client" })), "audience mismatch");
  });

  it("rejects a wrong issuer", async () => {
    await expectReason(signToken(signer, validClaims(NOW, { iss: "https://evil.example.test" })), "issuer mismatch");
  });

  it("rejects a nonce mismatch", async () => {
    await expectReason(signToken(signer, validClaims(NOW, { nonce: "different" })), "nonce mismatch");
  });

  it("rejects a missing subject", async () => {
    await expectReason(signToken(signer, validClaims(NOW, { sub: "" })), "subject missing");
  });

  it("rejects expired tokens and tokens issued too long ago", async () => {
    const s = Math.floor(NOW / 1000);
    await expectReason(signToken(signer, validClaims(NOW, { exp: s })), "token expired");
    await expectReason(signToken(signer, validClaims(NOW, { iat: s - 400, exp: s + 10 })), "token too old");
  });

  it("rejects issued-at in the far future and not-before in the future", async () => {
    const s = Math.floor(NOW / 1000);
    await expectReason(signToken(signer, validClaims(NOW, { iat: s + 300, exp: s + 600 })), "iat in the future");
    await expectReason(signToken(signer, validClaims(NOW, { nbf: s + 300 })), "nbf not yet valid");
  });

  it("rejects non-RS256 algorithms, including none and HS256", async () => {
    const payload = Buffer.from(JSON.stringify(validClaims(NOW))).toString("base64url");
    const header = (alg: string) => Buffer.from(JSON.stringify({ alg, kid: signer.kid })).toString("base64url");
    await expectReason(`${header("none")}.${payload}.`, "algorithm not allowed");
    await expectReason(`${header("HS256")}.${payload}.c2ln`, "algorithm not allowed");
  });

  it("rejects a token signed by a different key", async () => {
    const attacker = makeSigner("kid-1");
    await expectReason(signToken(attacker, validClaims(NOW)), "signature invalid");
  });

  it("rejects a tampered payload", async () => {
    const token = signToken(signer, validClaims(NOW));
    const [h, , s] = token.split(".");
    const forged = Buffer.from(JSON.stringify(validClaims(NOW, { sub: "admin" }))).toString("base64url");
    await expectReason(`${h}.${forged}.${s}`, "signature invalid");
  });

  it("rejects malformed tokens and bad headers", async () => {
    await expectReason("a.b", "token shape");
    await expectReason("", "token size");
    await expectReason(signToken(signer, validClaims(NOW), { typ: "at+jwt" }), "type not allowed");
    await expectReason(signToken(signer, validClaims(NOW), { kid: undefined }), "kid missing");
  });

  it("propagates unknown key ids from the key resolver", async () => {
    await expectReason(signToken(makeSigner("kid-unknown"), validClaims(NOW)), "signing key not found");
  });
});

describe("createJwksClient", () => {
  const jwks = (keysArray: unknown[]) =>
    vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ keys: keysArray }) })) as unknown as FetchLike;

  it("skips private keys, non-RSA keys and non-sig keys, and caches by kid", async () => {
    const fetcher = jwks([
      { ...signer.publicJwk, d: "AAAA" },
      { kty: "EC", kid: "ec", crv: "P-256", x: "x", y: "y" },
      { ...signer.publicJwk, use: "enc" },
      signer.publicJwk,
    ]);
    const client = createJwksClient({ jwksUri: "https://auth.example.test/oidc/jwks", fetcher, clock: () => NOW });
    await client.getKey(signer.kid);
    await client.getKey(signer.kid);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches on unknown kid only after the cooldown", async () => {
    let clock = NOW;
    const fetcher = jwks([signer.publicJwk]);
    const client = createJwksClient({ jwksUri: "https://auth.example.test/oidc/jwks", fetcher, clock: () => clock, refreshCooldownMs: 30_000 });
    await expect(client.getKey("missing")).rejects.toThrow("signing key not found");
    await expect(client.getKey("missing")).rejects.toThrow("signing key not found");
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 30_000;
    await expect(client.getKey("missing")).rejects.toThrow("signing key not found");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent refreshes into one request", async () => {
    const fetcher = jwks([signer.publicJwk]);
    const client = createJwksClient({ jwksUri: "https://auth.example.test/oidc/jwks", fetcher, clock: () => NOW });
    await Promise.all([client.getKey(signer.kid), client.getKey(signer.kid), client.getKey(signer.kid)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
