import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import type { CentralOidcConfig } from "./config.js";

/** Test-only helpers. Not exported from index.ts. */
export const TEST_ISSUER = "https://auth.example.test/oidc";
export const TEST_CLIENT_ID = "sorted-test-client";
export const TEST_NONCE = "nonce-fixture-0000000000000000000000000000000000";

export function testConfig(overrides: Partial<CentralOidcConfig> = {}): CentralOidcConfig {
  return Object.freeze({
    issuer: TEST_ISSUER,
    jwksUri: "https://auth.example.test/oidc/jwks",
    clientId: TEST_CLIENT_ID,
    redirectUri: "https://sorted.example.test/auth/callback",
    audience: "https://api.example.test",
    scope: "openid profile email",
    stateKey: Buffer.alloc(32, 7),
    allowInsecureLocalhost: false,
    ...overrides,
  });
}

export interface TestSigner {
  readonly privateKey: KeyObject;
  readonly publicJwk: Record<string, unknown>;
  readonly kid: string;
}

export function makeSigner(kid = "kid-1"): TestSigner {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
  return { privateKey, publicJwk, kid };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function signToken(
  signer: TestSigner,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = {},
): string {
  const h = b64({ alg: "RS256", typ: "JWT", kid: signer.kid, ...header });
  const p = b64(payload);
  const sign = createSign("RSA-SHA256");
  sign.update(`${h}.${p}`, "utf8");
  sign.end();
  return `${h}.${p}.${sign.sign(signer.privateKey).toString("base64url")}`;
}

export function validClaims(now: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const seconds = Math.floor(now / 1000);
  return {
    iss: TEST_ISSUER,
    aud: TEST_CLIENT_ID,
    sub: "user-123",
    nonce: TEST_NONCE,
    iat: seconds,
    exp: seconds + 120,
    ...overrides,
  };
}
