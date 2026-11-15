import { describe, expect, it } from "vitest";
import { CENTRAL_CLIENT_ENV, parseCentralOidcConfig } from "./config";
import { CentralClientError } from "./errors";

const KEY = Buffer.alloc(32, 9).toString("base64");

function baseEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [CENTRAL_CLIENT_ENV.issuer]: "https://auth.example.test/oidc",
    [CENTRAL_CLIENT_ENV.jwksUri]: "https://auth.example.test/oidc/jwks",
    [CENTRAL_CLIENT_ENV.audience]: "https://api.example.test",
    [CENTRAL_CLIENT_ENV.stateKey]: KEY,
    [CENTRAL_CLIENT_ENV.clientId]: "sorted-client",
    [CENTRAL_CLIENT_ENV.redirectUri]: "https://sorted.example.test/auth/callback",
    ...overrides,
  };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof CentralClientError) return error.code;
    throw error;
  }
  return "none";
}

describe("parseCentralOidcConfig", () => {
  it("reads every required TITAN_* variable into a frozen config", () => {
    const config = parseCentralOidcConfig(baseEnv());
    expect(config.issuer).toBe("https://auth.example.test/oidc");
    expect(config.jwksUri).toBe("https://auth.example.test/oidc/jwks");
    expect(config.clientId).toBe("sorted-client");
    expect(config.redirectUri).toBe("https://sorted.example.test/auth/callback");
    expect(config.audience).toBe("https://api.example.test");
    expect(config.scope).toBe("openid profile email");
    expect(config.stateKey.length).toBe(32);
    expect(config.allowInsecureLocalhost).toBe(false);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("names the missing variable without echoing any value", () => {
    const env = baseEnv({ [CENTRAL_CLIENT_ENV.clientId]: undefined });
    expect(() => parseCentralOidcConfig(env)).toThrow(/TITAN_FIELD_CLIENT_ID must be set/);
    expect(codeOf(() => parseCentralOidcConfig(env))).toBe("config_invalid");
  });

  it("rejects http issuers unless the localhost dev flag is exactly 1", () => {
    const http = baseEnv({ [CENTRAL_CLIENT_ENV.issuer]: "http://localhost:3001/oidc", [CENTRAL_CLIENT_ENV.jwksUri]: "http://localhost:3001/oidc/jwks", [CENTRAL_CLIENT_ENV.redirectUri]: "http://localhost:3000/cb" });
    expect(codeOf(() => parseCentralOidcConfig(http))).toBe("config_invalid");
    expect(codeOf(() => parseCentralOidcConfig({ ...http, [CENTRAL_CLIENT_ENV.insecureLocalhost]: "true" }))).toBe("config_invalid");
    expect(parseCentralOidcConfig({ ...http, [CENTRAL_CLIENT_ENV.insecureLocalhost]: "1" }).allowInsecureLocalhost).toBe(true);
  });

  it("rejects a JWKS URI on a different origin than the issuer", () => {
    const env = baseEnv({ [CENTRAL_CLIENT_ENV.jwksUri]: "https://evil.example.test/jwks" });
    expect(codeOf(() => parseCentralOidcConfig(env))).toBe("config_invalid");
  });

  it("rejects issuers or redirects carrying credentials, query or fragment", () => {
    expect(codeOf(() => parseCentralOidcConfig(baseEnv({ [CENTRAL_CLIENT_ENV.issuer]: "https://u:p@auth.example.test/oidc" })))).toBe("config_invalid");
    expect(codeOf(() => parseCentralOidcConfig(baseEnv({ [CENTRAL_CLIENT_ENV.redirectUri]: "https://sorted.example.test/cb?x=1" })))).toBe("config_invalid");
    expect(codeOf(() => parseCentralOidcConfig(baseEnv({ [CENTRAL_CLIENT_ENV.redirectUri]: "https://sorted.example.test/cb#frag" })))).toBe("config_invalid");
  });

  it("rejects a state key that is not base64 of exactly 32 bytes, without leaking it", () => {
    const bad = "c2hvcnQ=";
    const env = baseEnv({ [CENTRAL_CLIENT_ENV.stateKey]: bad });
    expect(codeOf(() => parseCentralOidcConfig(env))).toBe("config_invalid");
    try {
      parseCentralOidcConfig(env);
    } catch (error) {
      expect((error as Error).message).not.toContain(bad);
    }
  });

  it("rejects client ids with whitespace", () => {
    expect(codeOf(() => parseCentralOidcConfig(baseEnv({ [CENTRAL_CLIENT_ENV.clientId]: "a b" })))).toBe("config_invalid");
  });
});
