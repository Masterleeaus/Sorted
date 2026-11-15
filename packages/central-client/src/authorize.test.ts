import { describe, expect, it, vi } from "vitest";
import { beginLogin, buildTokenExchangeBody, LOGIN_TTL_MS, openPendingLogin } from "./authorize";
import { CentralClientError } from "./errors";
import { codeChallengeS256 } from "./pkce";
import { testConfig } from "./test-helpers";

/** Distinct bytes per call, so state, nonce and verifier differ within one login. */
function counterRandom(): (n: number) => Buffer {
  let next = 1;
  return (n) => Buffer.alloc(n, next++);
}

const discovery = Object.freeze({
  authorizationEndpoint: "https://auth.example.test/oidc/auth",
  tokenEndpoint: "https://auth.example.test/oidc/token",
});

describe("beginLogin", () => {
  it("builds an S256 PKCE authorization URL with state and nonce", () => {
    const now = 1_000_000;
    const result = beginLogin({ config: testConfig(), discovery, now, random: counterRandom() });
    const url = new URL(result.authorizationUrl);
    expect(url.origin + url.pathname).toBe(discovery.authorizationEndpoint);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("sorted-test-client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://sorted.example.test/auth/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(result.state);
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("nonce")).not.toBe(result.state);
    expect(url.searchParams.get("scope")).toBe("openid profile email");
  });

  it("stores only a digest, a sealed verifier and a sealed nonce", () => {
    const result = beginLogin({ config: testConfig(), discovery, now: 1_000, random: counterRandom() });
    const serialised = JSON.stringify(result.pending);
    expect(serialised).not.toContain(result.state);
    expect(result.pending.stateDigest).not.toBe(result.state);
    expect(result.pending.sealedCodeVerifier.startsWith("v1.")).toBe(true);
    expect(result.pending.sealedNonce.startsWith("v1.")).toBe(true);
    expect(result.pending.expiresAt).toBe(1_000 + LOGIN_TTL_MS);
  });

  it("produces fresh state on every call", () => {
    const a = beginLogin({ config: testConfig(), discovery });
    const b = beginLogin({ config: testConfig(), discovery });
    expect(a.state).not.toBe(b.state);
  });
});

describe("openPendingLogin", () => {
  it("returns the verifier and nonce that match the challenge sent to the provider", () => {
    const config = testConfig();
    const begun = beginLogin({ config, discovery, now: 0, random: counterRandom() });
    const opened = openPendingLogin({ config, pending: begun.pending, returnedState: begun.state, now: 1000 });
    const url = new URL(begun.authorizationUrl);
    expect(opened.codeVerifier).toHaveLength(43);
    expect(codeChallengeS256(opened.codeVerifier)).toBe(url.searchParams.get("code_challenge"));
    expect(opened.nonce).toBe(url.searchParams.get("nonce"));
  });

  it("rejects a mismatched or missing state", () => {
    const config = testConfig();
    const begun = beginLogin({ config, discovery, now: 0 });
    expect(() => openPendingLogin({ config, pending: begun.pending, returnedState: "other", now: 1 })).toThrow(/state mismatch/);
    expect(() => openPendingLogin({ config, pending: begun.pending, returnedState: "", now: 1 })).toThrow(/state missing/);
  });

  it("rejects logins past the TTL", () => {
    const config = testConfig();
    const begun = beginLogin({ config, discovery, now: 0 });
    const err = (() => {
      try {
        openPendingLogin({ config, pending: begun.pending, returnedState: begun.state, now: LOGIN_TTL_MS });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(CentralClientError);
    expect((err as CentralClientError).code).toBe("login_expired");
  });

  it("fails closed when the stored record was sealed under another key", () => {
    const begun = beginLogin({ config: testConfig(), discovery, now: 0 });
    expect(() =>
      openPendingLogin({ config: testConfig({ stateKey: Buffer.alloc(32, 1) }), pending: begun.pending, returnedState: begun.state, now: 1 }),
    ).toThrow(CentralClientError);
  });
});

describe("buildTokenExchangeBody", () => {
  it("encodes the authorization code grant with the PKCE verifier", () => {
    const body = buildTokenExchangeBody(testConfig(), "code-abc", "verifier-xyz");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-abc");
    expect(body.get("code_verifier")).toBe("verifier-xyz");
    expect(body.get("redirect_uri")).toBe("https://sorted.example.test/auth/callback");
  });

  it("rejects an empty code", () => {
    expect(() => buildTokenExchangeBody(testConfig(), "", "v")).toThrow(CentralClientError);
  });
});

describe("module import", () => {
  it("performs no network call when the package is imported", async () => {
    vi.resetModules();
    const spy = vi.spyOn(globalThis, "fetch");
    await import("./index");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
