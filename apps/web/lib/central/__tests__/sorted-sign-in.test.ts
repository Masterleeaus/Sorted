import { generateKeyPairSync, createSign, randomBytes, type KeyObject } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodePendingCookie,
  encodePendingCookie,
  finishCentralSignIn,
  isCentralSignInEnabled,
  startCentralSignIn,
  type LinkedLocalUser,
} from "../sorted-sign-in";

// Stub Central: discovery, JWKS and token endpoint, with RS256 ID tokens signed by a test key.
const ISSUER = "https://auth.example.test/oidc";
const TOKEN_ENDPOINT = `${ISSUER}/token`;
const AUTH_ENDPOINT = `${ISSUER}/auth`;
const kid = "kid-test";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };

const env = {
  TITAN_SORTED_CENTRAL_ENABLED: "true",
  TITAN_OIDC_ISSUER: ISSUER,
  TITAN_OIDC_JWKS_URI: `${ISSUER}/jwks`,
  TITAN_FIELD_CLIENT_ID: "sorted-test-client",
  TITAN_FIELD_REDIRECT_URI: "https://sorted.example.test/api/central/callback",
  TITAN_FIELD_AUDIENCE: "https://api.example.test",
  TITAN_OIDC_STATE_KEY: randomBytes(32).toString("base64"),
};

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
function signIdToken(claims: Record<string, unknown>, key: KeyObject = privateKey): string {
  const h = b64({ alg: "RS256", typ: "JWT", kid });
  const p = b64(claims);
  const s = createSign("RSA-SHA256");
  s.update(`${h}.${p}`);
  s.end();
  return `${h}.${p}.${s.sign(key).toString("base64url")}`;
}

type Stub = { fetcher: (input: string, init?: RequestInit) => Promise<Response>; tokenCalls: number; nonceSeen: () => string | null; lastIdTokenClaims: Record<string, unknown> };

function makeStub(opts: { discoveryStatus?: number; tokenOk?: boolean; sub?: string; tamperNonce?: boolean } = {}): Stub {
  const stub: Stub = {
    tokenCalls: 0,
    nonceSeen: () => currentNonce,
    lastIdTokenClaims: {},
    fetcher: async (input, init) => {
      if (input === `${ISSUER}/.well-known/openid-configuration`) {
        if (opts.discoveryStatus) return new Response("err", { status: opts.discoveryStatus });
        return new Response(JSON.stringify({ issuer: ISSUER, authorization_endpoint: AUTH_ENDPOINT, token_endpoint: TOKEN_ENDPOINT }), { status: 200 });
      }
      if (input === `${ISSUER}/jwks`) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      if (input === TOKEN_ENDPOINT) {
        stub.tokenCalls++;
        if (opts.tokenOk === false) return new Response("nope", { status: 400 });
        const claims = {
          iss: ISSUER,
          aud: "sorted-test-client",
          sub: opts.sub ?? "central-user-1",
          nonce: opts.tamperNonce ? "wrong-nonce-value-0000000000000000000000" : currentNonce,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 120,
        };
        stub.lastIdTokenClaims = claims;
        return new Response(JSON.stringify({ id_token: signIdToken(claims) }), { status: 200 });
      }
      throw new Error(`unexpected fetch ${input} ${init?.method ?? "GET"}`);
    },
  };
  return stub;
}

// The nonce travels in the authorization URL; the stub reads it back the way a browser would.
let currentNonce: string | null = null;
function noteNonce(location: string) {
  currentNonce = new URL(location).searchParams.get("nonce");
}

const linked: LinkedLocalUser = { userId: "u-1", accountId: "a-1", role: "owner" };
const now = () => Date.now();

async function signIn(stub: Stub) {
  const started = await startCentralSignIn({ env, fetcher: stub.fetcher, now });
  if (started.kind !== "redirect") throw new Error(`expected redirect, got ${started.kind}`);
  noteNonce(started.location);
  return started;
}

afterEach(() => {
  vi.unstubAllEnvs();
  currentNonce = null;
});

describe("flag", () => {
  it("is off unless the value is exactly 'true'", () => {
    expect(isCentralSignInEnabled({})).toBe(false);
    expect(isCentralSignInEnabled({ TITAN_SORTED_CENTRAL_ENABLED: "false" })).toBe(false);
    expect(isCentralSignInEnabled({ TITAN_SORTED_CENTRAL_ENABLED: "TRUE" })).toBe(false);
    expect(isCentralSignInEnabled({ TITAN_SORTED_CENTRAL_ENABLED: "1" })).toBe(false);
    expect(isCentralSignInEnabled({ TITAN_SORTED_CENTRAL_ENABLED: "true" })).toBe(true);
  });

  it("returns disabled for both routes without any network call when off", async () => {
    const stub = makeStub();
    const off = { ...env, TITAN_SORTED_CENTRAL_ENABLED: undefined };
    expect((await startCentralSignIn({ env: off, fetcher: stub.fetcher })).kind).toBe("disabled");
    expect((await finishCentralSignIn({ code: "c", state: "s", error: null, pendingCookie: "x" }, { env: off, fetcher: stub.fetcher })).kind).toBe("disabled");
    expect(stub.tokenCalls).toBe(0);
  });
});

describe("sign-in start", () => {
  it("redirects to the Central authorization endpoint with PKCE and a sealed pending cookie", async () => {
    const stub = makeStub();
    const started = await startCentralSignIn({ env, fetcher: stub.fetcher, now });
    if (started.kind !== "redirect") throw new Error("expected redirect");
    const url = new URL(started.location);
    expect(url.origin + url.pathname).toBe(AUTH_ENDPOINT);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("client_id")).toBe("sorted-test-client");
    expect(url.searchParams.get("state")).toBeTruthy();
    const pending = decodePendingCookie(started.pendingCookie);
    expect(pending).not.toBeNull();
    expect(JSON.stringify(pending)).not.toContain(url.searchParams.get("state") ?? "@@");
  });

  it("reports unavailable when discovery fails", async () => {
    const stub = makeStub({ discoveryStatus: 500 });
    expect((await startCentralSignIn({ env, fetcher: stub.fetcher })).kind).toBe("unavailable");
  });

  it("reports unavailable when required config is missing", async () => {
    const { TITAN_OIDC_ISSUER: _omit, ...partial } = env;
    expect((await startCentralSignIn({ env: partial, fetcher: makeStub().fetcher })).kind).toBe("unavailable");
  });
});

describe("callback", () => {
  it("signs in a linked user and clears the pending cookie", async () => {
    const stub = makeStub({ sub: "central-user-1" });
    const started = await signIn(stub);
    const state = new URL(started.location).searchParams.get("state");
    const result = await finishCentralSignIn(
      { code: "auth-code", state, error: null, pendingCookie: started.pendingCookie },
      { env, fetcher: stub.fetcher, now, resolveLocalUser: async (s) => (s.sub === "central-user-1" ? linked : null) },
    );
    expect(result).toEqual({ kind: "signed_in", user: linked, clearPendingCookie: true });
    expect(stub.tokenCalls).toBe(1);
  });

  it("fails closed when the Central subject has no local link (default resolver)", async () => {
    const stub = makeStub();
    const started = await signIn(stub);
    const state = new URL(started.location).searchParams.get("state");
    const result = await finishCentralSignIn({ code: "c", state, error: null, pendingCookie: started.pendingCookie }, { env, fetcher: stub.fetcher, now });
    expect(result.kind).toBe("failed");
  });

  it("rejects a returned state that does not match the pending login, without calling the token endpoint", async () => {
    const stub = makeStub();
    const started = await signIn(stub);
    const result = await finishCentralSignIn(
      { code: "c", state: "not-the-state-value-0000000000", error: null, pendingCookie: started.pendingCookie },
      { env, fetcher: stub.fetcher, now, resolveLocalUser: async () => linked },
    );
    expect(result.kind).toBe("failed");
    expect(stub.tokenCalls).toBe(0);
  });

  it("rejects an ID token whose nonce does not match the sealed nonce", async () => {
    const stub = makeStub({ tamperNonce: true });
    const started = await signIn(stub);
    const state = new URL(started.location).searchParams.get("state");
    const result = await finishCentralSignIn(
      { code: "c", state, error: null, pendingCookie: started.pendingCookie },
      { env, fetcher: stub.fetcher, now, resolveLocalUser: async () => linked },
    );
    expect(result.kind).toBe("failed");
  });

  it("fails when the token endpoint rejects the code", async () => {
    const stub = makeStub({ tokenOk: false });
    const started = await signIn(stub);
    const state = new URL(started.location).searchParams.get("state");
    const result = await finishCentralSignIn(
      { code: "c", state, error: null, pendingCookie: started.pendingCookie },
      { env, fetcher: stub.fetcher, now, resolveLocalUser: async () => linked },
    );
    expect(result.kind).toBe("failed");
  });

  it("fails on a provider error, a missing code, or a missing pending cookie", async () => {
    const stub = makeStub();
    const started = await signIn(stub);
    const state = new URL(started.location).searchParams.get("state");
    const deps = { env, fetcher: stub.fetcher, now, resolveLocalUser: async () => linked };
    expect((await finishCentralSignIn({ code: "c", state, error: "access_denied", pendingCookie: started.pendingCookie }, deps)).kind).toBe("failed");
    expect((await finishCentralSignIn({ code: null, state, error: null, pendingCookie: started.pendingCookie }, deps)).kind).toBe("failed");
    expect((await finishCentralSignIn({ code: "c", state, error: null, pendingCookie: undefined }, deps)).kind).toBe("failed");
    expect(stub.tokenCalls).toBe(0);
  });

  it("fails an expired pending login", async () => {
    const stub = makeStub();
    const started = await signIn(stub);
    const state = new URL(started.location).searchParams.get("state");
    const later = () => Date.now() + 11 * 60 * 1000;
    const result = await finishCentralSignIn(
      { code: "c", state, error: null, pendingCookie: started.pendingCookie },
      { env, fetcher: stub.fetcher, now: later, resolveLocalUser: async () => linked },
    );
    expect(result.kind).toBe("failed");
    expect(stub.tokenCalls).toBe(0);
  });

  it("round-trips the pending cookie encoding", () => {
    const pending = { stateDigest: "d", sealedCodeVerifier: "v", sealedNonce: "n", expiresAt: 5 };
    expect(decodePendingCookie(encodePendingCookie(pending))).toEqual(pending);
    expect(decodePendingCookie("%%%")).toBeNull();
  });
});

describe("route handlers", () => {
  it("sign-in and callback return 404 when the flag is off", async () => {
    vi.stubEnv("TITAN_SORTED_CENTRAL_ENABLED", "");
    const signInRoute = await import("@/app/api/central/sign-in/route");
    const callbackRoute = await import("@/app/api/central/callback/route");
    const res1 = await signInRoute.GET();
    expect(res1.status).toBe(404);
    const { NextRequest } = await import("next/server");
    const res2 = await callbackRoute.GET(new NextRequest("https://sorted.example.test/api/central/callback?code=c&state=s"));
    expect(res2.status).toBe(404);
  });
});
