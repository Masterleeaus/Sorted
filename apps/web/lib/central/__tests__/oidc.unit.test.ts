import { describe, it, expect } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import {
  OidcError,
  createAuthorizationRequest,
  createPkcePair,
  exchangeAuthorizationCode,
  fetchDiscovery,
  globalLogoutUrl,
  stateMatches,
  verifyIdToken,
} from "../oidc";
import { DISCOVERY, OIDC_CONFIG, ORIGIN, fakeFetch, jsonResponse } from "./fakes";

const NOW = 1_794_240_000; // fixed clock, seconds

async function signer() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-kid", alg: "RS256", use: "sig" };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  return {
    jwks,
    sign: (claims: Record<string, unknown>, opts: { key?: CryptoKey; exp?: number; iat?: number } = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
        .setIssuedAt(opts.iat ?? NOW)
        .setExpirationTime(opts.exp ?? NOW + 300)
        .sign(opts.key ?? privateKey),
  };
}

const VALID_CLAIMS = {
  iss: DISCOVERY.issuer,
  aud: OIDC_CONFIG.audience,
  sub: "usr_test_0001",
  nonce: "nonce-under-test",
};

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B S256 vector", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const pair = createPkcePair(() => Buffer.from(verifier, "base64url"));
    expect(pair.verifier).toBe(verifier);
    expect(pair.challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("authorization request", () => {
  it("sends PKCE, state, nonce and the per-app audience, and nothing identifying", () => {
    let i = 0;
    const req = createAuthorizationRequest(DISCOVERY, OIDC_CONFIG, () => Buffer.alloc(32, ++i));
    const url = new URL(req.url);
    expect(url.origin + url.pathname).toBe(DISCOVERY.authorization_endpoint);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(OIDC_CONFIG.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(OIDC_CONFIG.redirectUri);
    expect(url.searchParams.get("audience")).toBe(OIDC_CONFIG.audience);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(req.state);
    expect(url.searchParams.get("nonce")).toBe(req.nonce);
    expect(url.searchParams.get("code_challenge")).toBe(createPkcePair(() => Buffer.from(req.verifier, "base64url")).challenge);
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(req.state).not.toBe(req.nonce);
  });
});

describe("state comparison", () => {
  it("accepts only an exact match", () => {
    expect(stateMatches("abc123", "abc123")).toBe(true);
    expect(stateMatches("abc123", "abc124")).toBe(false);
    expect(stateMatches("abc123", "abc1234")).toBe(false);
    expect(stateMatches("abc123", null)).toBe(false);
    expect(stateMatches("abc123", undefined)).toBe(false);
  });
});

describe("discovery", () => {
  it("accepts endpoints on the issuer origin", async () => {
    const { fn, calls } = fakeFetch(() => jsonResponse(DISCOVERY));
    await expect(fetchDiscovery(ORIGIN, fn)).resolves.toEqual(DISCOVERY);
    expect(calls[0]?.url).toBe(`${ORIGIN}/.well-known/openid-configuration`);
  });

  it("refuses an endpoint on another origin", async () => {
    const { fn } = fakeFetch(() => jsonResponse({ ...DISCOVERY, token_endpoint: "https://other.test/token" }));
    await expect(fetchDiscovery(ORIGIN, fn)).rejects.toMatchObject({ code: "bad_discovery" });
  });

  it("refuses a non-https endpoint", async () => {
    const { fn } = fakeFetch(() => jsonResponse({ ...DISCOVERY, jwks_uri: "http://central.test/jwks" }));
    await expect(fetchDiscovery(ORIGIN, fn)).rejects.toMatchObject({ code: "bad_discovery" });
  });
});

describe("token exchange", () => {
  it("posts the code and PKCE verifier with client authentication", async () => {
    const { fn, calls } = fakeFetch(() => jsonResponse({ id_token: "header.payload.sig", access_token: "at" }));
    const out = await exchangeAuthorizationCode({ discovery: DISCOVERY, config: OIDC_CONFIG, code: "code-1", verifier: "ver-1", fetch: fn });
    expect(out).toEqual({ idToken: "header.payload.sig", accessToken: "at" });
    const init = calls[0]?.init;
    expect(calls[0]?.url).toBe(DISCOVERY.token_endpoint);
    expect(String((init?.headers as Record<string, string>).authorization)).toMatch(/^Basic /);
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("ver-1");
    expect(body.get("redirect_uri")).toBe(OIDC_CONFIG.redirectUri);
  });

  it("does not echo the token endpoint body in its error", async () => {
    const { fn } = fakeFetch(() => new Response("leaked-body-value", { status: 400 }));
    const err = await exchangeAuthorizationCode({ discovery: DISCOVERY, config: OIDC_CONFIG, code: "c", verifier: "v", fetch: fn }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OidcError);
    expect((err as OidcError).code).toBe("token_exchange_failed");
    expect((err as Error).message).not.toContain("leaked-body-value");
  });
});

describe("ID token verification", () => {
  it("accepts a token with the right issuer, audience, nonce and lifetime", async () => {
    const s = await signer();
    const token = await s.sign(VALID_CLAIMS);
    await expect(verifyIdToken({ idToken: token, issuer: DISCOVERY.issuer, audience: OIDC_CONFIG.audience, nonce: "nonce-under-test", jwks: s.jwks, now: NOW + 10 })).resolves.toMatchObject({ sub: "usr_test_0001" });
  });

  it("refuses a wrong audience", async () => {
    const s = await signer();
    const token = await s.sign({ ...VALID_CLAIMS, aud: "urn:test:other-app" });
    await expect(verifyIdToken({ idToken: token, issuer: DISCOVERY.issuer, audience: OIDC_CONFIG.audience, nonce: "nonce-under-test", jwks: s.jwks, now: NOW })).rejects.toMatchObject({ code: "wrong_audience" });
  });

  it("refuses an expired token", async () => {
    const s = await signer();
    const token = await s.sign(VALID_CLAIMS, { iat: NOW - 1000, exp: NOW - 500 });
    await expect(verifyIdToken({ idToken: token, issuer: DISCOVERY.issuer, audience: OIDC_CONFIG.audience, nonce: "nonce-under-test", jwks: s.jwks, now: NOW })).rejects.toMatchObject({ code: "expired_id_token" });
  });

  it("refuses a wrong issuer", async () => {
    const s = await signer();
    const token = await s.sign({ ...VALID_CLAIMS, iss: "https://evil.test/oidc" });
    await expect(verifyIdToken({ idToken: token, issuer: DISCOVERY.issuer, audience: OIDC_CONFIG.audience, nonce: "nonce-under-test", jwks: s.jwks, now: NOW })).rejects.toMatchObject({ code: "wrong_issuer" });
  });

  it("refuses a token signed by another key", async () => {
    const s = await signer();
    const other = await generateKeyPair("RS256");
    const token = await s.sign(VALID_CLAIMS, { key: other.privateKey });
    await expect(verifyIdToken({ idToken: token, issuer: DISCOVERY.issuer, audience: OIDC_CONFIG.audience, nonce: "nonce-under-test", jwks: s.jwks, now: NOW })).rejects.toMatchObject({ code: "bad_signature" });
  });

  it("refuses a nonce from another login", async () => {
    const s = await signer();
    const token = await s.sign(VALID_CLAIMS);
    await expect(verifyIdToken({ idToken: token, issuer: DISCOVERY.issuer, audience: OIDC_CONFIG.audience, nonce: "some-other-nonce", jwks: s.jwks, now: NOW })).rejects.toMatchObject({ code: "nonce_mismatch" });
  });
});

describe("global logout", () => {
  it("points at Central's global logout path on Central's origin", () => {
    expect(globalLogoutUrl(OIDC_CONFIG)).toBe(`${ORIGIN}/auth/titan/global-logout`);
  });
});
