import { describe, it, expect } from "vitest";
import {
  CentralConfigError,
  isCentralFlagReadEnabled,
  readCentralOidcConfig,
  readCentralOutboxSecret,
  readCentralServiceConfig,
} from "../config";

const FULL_ENV = {
  CENTRAL_ORIGIN: "https://central.test",
  CENTRAL_OIDC_AUDIENCE: "urn:test:sorted-app",
  CENTRAL_OIDC_CLIENT_ID: "test-client-id",
  CENTRAL_OIDC_CLIENT_SECRET: "test-client-secret-value",
  APP_URL: "https://sorted.test",
  CENTRAL_SERVICE_AUDIENCE: "urn:test:product:sorted",
  CENTRAL_SERVICE_CLIENT_ID: "test-service-id",
  CENTRAL_SERVICE_CLIENT_SECRET: "test-service-secret-value",
  CENTRAL_OUTBOX_SECRET: "x".repeat(32),
};

describe("central config", () => {
  it("reads the OIDC config and derives the callback from APP_URL", () => {
    const config = readCentralOidcConfig(FULL_ENV);
    expect(config).toEqual({
      origin: "https://central.test",
      audience: "urn:test:sorted-app",
      clientId: "test-client-id",
      clientSecret: "test-client-secret-value",
      redirectUri: "https://sorted.test/auth/titan/callback",
    });
  });

  it.each([
    "CENTRAL_ORIGIN",
    "CENTRAL_OIDC_AUDIENCE",
    "CENTRAL_OIDC_CLIENT_ID",
    "CENTRAL_OIDC_CLIENT_SECRET",
    "APP_URL",
  ])("fails clearly and names %s when it is unset", (name) => {
    const env: Record<string, string | undefined> = { ...FULL_ENV, [name]: undefined };
    const err = (() => {
      try {
        readCentralOidcConfig(env);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(CentralConfigError);
    expect((err as CentralConfigError).variable).toBe(name);
    expect((err as Error).message).toContain(name);
  });

  it("treats a blank value as unset", () => {
    expect(() => readCentralOidcConfig({ ...FULL_ENV, CENTRAL_OIDC_CLIENT_SECRET: "   " })).toThrow(CentralConfigError);
  });

  it("refuses a non-https or non-origin CENTRAL_ORIGIN without echoing the value", () => {
    const http = "http://central-value-that-must-not-echo.test";
    expect(() => readCentralOidcConfig({ ...FULL_ENV, CENTRAL_ORIGIN: http })).toThrow(/must use https/);
    try {
      readCentralOidcConfig({ ...FULL_ENV, CENTRAL_ORIGIN: http });
    } catch (e) {
      expect((e as Error).message).not.toContain("central-value-that-must-not-echo");
    }
    expect(() => readCentralOidcConfig({ ...FULL_ENV, CENTRAL_ORIGIN: "https://central.test/path" })).toThrow(/origin only/);
  });

  it("reads the service config for the product audience", () => {
    expect(readCentralServiceConfig(FULL_ENV)).toEqual({
      origin: "https://central.test",
      audience: "urn:test:product:sorted",
      clientId: "test-service-id",
      clientSecret: "test-service-secret-value",
    });
    expect(() => readCentralServiceConfig({ ...FULL_ENV, CENTRAL_SERVICE_AUDIENCE: undefined })).toThrow(/CENTRAL_SERVICE_AUDIENCE/);
  });

  it("requires an outbox secret of at least 32 characters", () => {
    expect(readCentralOutboxSecret(FULL_ENV)).toHaveLength(32);
    expect(() => readCentralOutboxSecret({ CENTRAL_OUTBOX_SECRET: "short" })).toThrow(/at least 32/);
    expect(() => readCentralOutboxSecret({})).toThrow(/CENTRAL_OUTBOX_SECRET is not set/);
  });

  it("enables flag reads only when explicitly set to 1", () => {
    expect(isCentralFlagReadEnabled({})).toBe(false);
    expect(isCentralFlagReadEnabled({ CENTRAL_FLAGS_READ_ENABLED: "true" })).toBe(false);
    expect(isCentralFlagReadEnabled({ CENTRAL_FLAGS_READ_ENABLED: "1" })).toBe(true);
  });
});
