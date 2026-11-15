import { describe, expect } from "vitest";
import { config, loadFixture } from "./support/fixtures";
import { contractTest, requireExport } from "./support/public-api";
import { centralVerifyLinkAssertion, NonceLedger, type LinkCentralContext } from "./support/central-stub";
import { keyByLabel, publishedKeySets } from "./support/link-cases";

/**
 * Product-side link assertion contract (LINKING.md). The package signs; the stub
 * Central verifies with the documented order.
 *
 * Pending: this contract needs an async signer that takes (input, { issuer, audience, keyId,
 * privateKey, nonceStore, ... }) and enforces the nonce store. The package's exported
 * signLinkAssertion(key, input, options) is synchronous with a different shape and is
 * not replaced here, to keep the package API backward compatible. The gate name
 * signLinkAssertionWithNonceStore is the export this test is waiting for.
 */

const test = contractTest(["signLinkAssertionWithNonceStore", "createMemoryLinkNonceStore"]);

type Refusals = {
  forbiddenClaims: string[];
  identifierInputs: Array<{ id: string; field: "sub" | "org" | "lu" | "la"; value: string }>;
  lifetimeInputs: Array<{ id: string; lifetimeSeconds: number }>;
  nonceInputs: Array<{ id: string; nonce: string }>;
};

const refusals = loadFixture<Refusals>("link-assertion/product-refusals.json");

type SignOptions = Record<string, unknown>;
type Signer = (input: Record<string, unknown>, options: SignOptions) => Promise<{ token: string; nonce: string; iat: number; exp: number }>;

describe("link assertion contract (product signer)", () => {
  const clockNow = config.clockEpochSeconds;
  const current = keyByLabel("sorted-current");
  const identity = {
    sub: config.centralRecord.sub,
    org: config.centralRecord.org,
    lu: config.command.lu,
    la: config.command.la,
  };

  function signOptions(extra: SignOptions = {}): SignOptions {
    const createStore = requireExport<(now: () => number) => unknown>("createMemoryLinkNonceStore");
    return {
      issuer: config.product,
      audience: config.linkAudience,
      keyId: current.kid,
      privateKey: current.privateKey,
      nonceStore: createStore(() => clockNow),
      now: () => clockNow,
      lifetimeSeconds: 120,
      nonceFactory: () => "q2XvR7kLmN0pTbZ3sYcW9A",
      ...extra,
    };
  }

  function centralContext(nowSeconds: number = clockNow): LinkCentralContext {
    return {
      application: config.application,
      nowSeconds,
      keySets: publishedKeySets(),
      record: config.centralRecord,
      command: config.command,
      nonces: new NonceLedger(),
    };
  }

  function decodeSegment(segment: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
  }

  test("signs a token with exactly the documented header and claim set", async () => {
    const sign = requireExport<Signer>("signLinkAssertionWithNonceStore");
    const { token } = await sign({ ...identity }, signOptions());
    const [headerSegment, payloadSegment] = token.split(".") as [string, string, string];
    expect(decodeSegment(headerSegment)).toEqual({ alg: "EdDSA", typ: "titan-link+jwt", kid: current.kid });
    expect(Object.keys(decodeSegment(payloadSegment)).sort()).toEqual(
      ["aud", "exp", "iat", "iss", "la", "lu", "nonce", "org", "sub"],
    );
    const payload = decodeSegment(payloadSegment);
    expect(payload.iss).toBe("sorted");
    expect(payload.aud).toBe("titan-central");
    expect((payload.exp as number) - (payload.iat as number)).toBe(120);
  });

  test("a token the package signs is accepted by the stub Central verifier", async () => {
    const sign = requireExport<Signer>("signLinkAssertionWithNonceStore");
    const { token } = await sign({ ...identity }, signOptions());
    const claims = centralVerifyLinkAssertion(token, centralContext());
    expect(claims).toMatchObject({ ...identity, iss: "sorted", aud: "titan-central" });
  });

  test("the stub Central refuses a replay of the same signed token", async () => {
    const sign = requireExport<Signer>("signLinkAssertionWithNonceStore");
    const { token } = await sign({ ...identity }, signOptions());
    const ctx = centralContext();
    centralVerifyLinkAssertion(token, ctx);
    let code: string | undefined;
    try {
      centralVerifyLinkAssertion(token, ctx);
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe("replayed");
  });

  test("refuses each forbidden identity claim before issuing a token", async () => {
    const sign = requireExport<Signer>("signLinkAssertionWithNonceStore");
    for (const claim of refusals.forbiddenClaims) {
      await expect(sign({ ...identity, [claim]: "value" }, signOptions())).rejects.toMatchObject({
        code: "forbidden_claim",
      });
    }
  });

  test("refuses identifiers that look like email addresses or display names", async () => {
    const sign = requireExport<Signer>("signLinkAssertionWithNonceStore");
    for (const input of refusals.identifierInputs) {
      await expect(sign({ ...identity, [input.field]: input.value }, signOptions())).rejects.toThrow();
    }
  });

  test("refuses lifetimes outside 1 to 300 whole seconds", async () => {
    const sign = requireExport<Signer>("signLinkAssertionWithNonceStore");
    for (const input of refusals.lifetimeInputs) {
      await expect(sign({ ...identity }, signOptions({ lifetimeSeconds: input.lifetimeSeconds }))).rejects.toThrow();
    }
  });

  test("refuses a malformed nonce", async () => {
    const sign = requireExport<Signer>("signLinkAssertionWithNonceStore");
    for (const input of refusals.nonceInputs) {
      await expect(sign({ ...identity }, signOptions({ nonceFactory: () => input.nonce }))).rejects.toThrow();
    }
  });

  test("refuses to reuse a nonce that was already issued", async () => {
    const sign = requireExport<Signer>("signLinkAssertionWithNonceStore");
    const shared = signOptions();
    await sign({ ...identity }, shared);
    await expect(sign({ ...identity }, shared)).rejects.toThrow();
  });

  test("refuses an assertion for a different local account than the one it signs", async () => {
    const sign = requireExport<Signer>("signLinkAssertionWithNonceStore");
    const { token } = await sign({ ...identity, la: "sorted-acct-9999" }, signOptions());
    expect(() => centralVerifyLinkAssertion(token, centralContext())).toThrow();
  });
});
