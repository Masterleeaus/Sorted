import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import {
  CentralServiceError,
  createCentralServiceClient,
  type FetchLike,
  type ServiceClientConfig,
} from "../service-client";
import { CentralNotConfiguredError, readServiceConfig } from "../config";

// Test-only Ed25519 key. Central's verifier is not called from these tests.
const { privateKey } = generateKeyPairSync("ed25519");
const PRODUCT_AUD = "urn:titan-central:product:sorted";
const OTHER_AUD = "urn:titan-central:product:other";
const CONFIG: ServiceClientConfig = {
  origin: "https://central.test.invalid",
  tokenEndpoint: "https://auth.test.invalid/oidc/token",
  clientId: "test-client-id",
  clientSecret: "test-client-secret-value",
  audience: PRODUCT_AUD,
};

async function makeToken(aud: string, exp: number, key: KeyObject = privateKey): Promise<string> {
  return new SignJWT({ scope: "access" })
    .setProtectedHeader({ alg: "EdDSA", kid: "test-service" })
    .setIssuer("https://central.test.invalid")
    .setAudience(aud)
    .setSubject("sorted-service")
    .setIssuedAt(exp - 3600)
    .setExpirationTime(exp)
    .sign(key);
}

type Call = { url: string; init?: RequestInit };

function fakeFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return handler(call);
  };
  return { fetchFn, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const tokenCalls = (calls: Call[]) => calls.filter((c) => c.url === CONFIG.tokenEndpoint);
const apiCalls = (calls: Call[]) => calls.filter((c) => c.url !== CONFIG.tokenEndpoint);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Central service client (client credentials, product audience)", () => {
  it("requests a token with the client-credentials grant, Basic auth and the product resource", async () => {
    const now = 1_800_000_000;
    const token = await makeToken(PRODUCT_AUD, now + 3600);
    const { fetchFn, calls } = fakeFetch((call) => {
      if (call.url === CONFIG.tokenEndpoint) return json(200, { access_token: token, expires_in: 3600, token_type: "Bearer" });
      return json(200, { allowed: true });
    });
    const client = createCentralServiceClient({ config: () => CONFIG, fetch: fetchFn, now: () => now });

    await client.accessCheck({ action: "read", resource: "job" });

    const [tokenCall] = tokenCalls(calls);
    const body = new URLSearchParams(String(tokenCall.init?.body));
    expect(tokenCall.init?.method).toBe("POST");
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("resource")).toBe(PRODUCT_AUD);
    expect(body.has("client_secret")).toBe(false);
    expect((tokenCall.init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`${CONFIG.clientId}:${CONFIG.clientSecret}`).toString("base64")}`,
    );
    // Secrets never appear in the URL.
    expect(tokenCall.url).not.toContain(CONFIG.clientSecret);
  });

  it("caches the token and refreshes it before expiry", async () => {
    let now = 1_800_000_000;
    let issued = 0;
    const { fetchFn, calls } = fakeFetch(async (call) => {
      if (call.url === CONFIG.tokenEndpoint) {
        issued += 1;
        return json(200, { access_token: await makeToken(PRODUCT_AUD, now + 300), expires_in: 300 });
      }
      return json(200, { allowed: true });
    });
    const client = createCentralServiceClient({ config: () => CONFIG, fetch: fetchFn, now: () => now });

    await client.accessCheck({ action: "read" });
    await client.accessCheck({ action: "read" });
    expect(issued).toBe(1);

    now += 300 - 60 + 1; // inside the refresh skew window
    await client.accessCheck({ action: "read" });
    expect(issued).toBe(2);
    expect(apiCalls(calls)).toHaveLength(3);
  });

  it("shares one token request between concurrent callers", async () => {
    const now = 1_800_000_000;
    const { fetchFn, calls } = fakeFetch(async (call) => {
      if (call.url === CONFIG.tokenEndpoint) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return json(200, { access_token: await makeToken(PRODUCT_AUD, now + 3600), expires_in: 3600 });
      }
      return json(200, { allowed: true });
    });
    const client = createCentralServiceClient({ config: () => CONFIG, fetch: fetchFn, now: () => now });

    await Promise.all([client.accessCheck({ a: 1 }), client.accessCheck({ a: 2 }), client.accessCheck({ a: 3 })]);
    expect(tokenCalls(calls)).toHaveLength(1);
  });

  it("refuses a token issued for another product and never calls Central with it", async () => {
    const now = 1_800_000_000;
    const { fetchFn, calls } = fakeFetch((call) => {
      if (call.url === CONFIG.tokenEndpoint) {
        return makeToken(OTHER_AUD, now + 3600).then((access_token) => json(200, { access_token, expires_in: 3600 }));
      }
      return json(200, { allowed: true });
    });
    const client = createCentralServiceClient({ config: () => CONFIG, fetch: fetchFn, now: () => now });

    const error = await client.accessCheck({ action: "read" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CentralServiceError);
    expect((error as CentralServiceError).code).toBe("token_audience_mismatch");
    expect(apiCalls(calls)).toHaveLength(0);
  });

  it("accepts an aud array that includes the product audience", async () => {
    const now = 1_800_000_000;
    const access_token = await new SignJWT({})
      .setProtectedHeader({ alg: "EdDSA" })
      .setAudience([OTHER_AUD, PRODUCT_AUD])
      .setExpirationTime(now + 3600)
      .sign(privateKey);
    const { fetchFn } = fakeFetch((call) =>
      call.url === CONFIG.tokenEndpoint
        ? json(200, { access_token, expires_in: 3600 })
        : json(200, { allowed: true }),
    );
    const client = createCentralServiceClient({ config: () => CONFIG, fetch: fetchFn, now: () => now });
    await expect(client.accessCheck({ action: "read" })).resolves.toEqual({ allowed: true });
  });

  it("refuses tenant parameters in the body before any network call", async () => {
    const { fetchFn, calls } = fakeFetch(() => json(200, {}));
    const client = createCentralServiceClient({ config: () => CONFIG, fetch: fetchFn });

    for (const body of [
      { organisation_id: "org_x" },
      { tenant: "t" },
      { cohort: "c" },
      { nested: { deeper: [{ tenant: "t" }] } },
    ]) {
      await expect(client.accessCheck(body)).rejects.toMatchObject({ code: "forbidden_tenant_parameter" });
    }
    expect(calls).toHaveLength(0);
  });

  it("retries once after 401 with a fresh token, then reports unauthorized", async () => {
    const now = 1_800_000_000;
    let issued = 0;
    const { fetchFn, calls } = fakeFetch(async (call) => {
      if (call.url === CONFIG.tokenEndpoint) {
        issued += 1;
        return json(200, { access_token: await makeToken(PRODUCT_AUD, now + 3600), expires_in: 3600 });
      }
      return json(401, { error: "invalid_token" });
    });
    const client = createCentralServiceClient({ config: () => CONFIG, fetch: fetchFn, now: () => now });

    const error = await client.accessCheck({ action: "read" }).catch((e: unknown) => e);
    expect((error as CentralServiceError).code).toBe("unauthorized");
    expect(issued).toBe(2);
    expect(apiCalls(calls)).toHaveLength(2);
  });

  it("maps 403 to forbidden without retrying", async () => {
    const now = 1_800_000_000;
    const { fetchFn, calls } = fakeFetch(async (call) => {
      if (call.url === CONFIG.tokenEndpoint) {
        return json(200, { access_token: await makeToken(PRODUCT_AUD, now + 3600), expires_in: 3600 });
      }
      return json(403, { error: "denied" });
    });
    const client = createCentralServiceClient({ config: () => CONFIG, fetch: fetchFn, now: () => now });
    const error = await client.accessCheck({ action: "read" }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "forbidden", status: 403 });
    expect(apiCalls(calls)).toHaveLength(1);
  });

  it("never logs token material, including on failure paths", async () => {
    const now = 1_800_000_000;
    const logs: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    }
    const token = await makeToken(PRODUCT_AUD, now + 3600);
    const { fetchFn } = fakeFetch((call) => {
      if (call.url === CONFIG.tokenEndpoint) return json(200, { access_token: token, expires_in: 3600 });
      return json(403, { error: "denied", echoed: token });
    });
    const client = createCentralServiceClient({ config: () => CONFIG, fetch: fetchFn, now: () => now });

    const error = await client.accessCheck({ action: "read" }).catch((e: unknown) => e);
    expect(String(error)).not.toContain(token);
    expect(JSON.stringify(error)).not.toContain(token);
    expect(logs.join("\n")).not.toContain(token);
    expect(logs.join("\n")).not.toContain(CONFIG.clientSecret);
  });

  it("does not echo the token endpoint response body on failure", async () => {
    const { fetchFn } = fakeFetch(() => json(401, { error: "invalid_client", secret: "leak-me" }));
    const client = createCentralServiceClient({ config: () => CONFIG, fetch: fetchFn });
    const error = await client.accessCheck({ a: 1 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "token_request_failed", status: 401 });
    expect(String(error)).not.toContain("leak-me");
  });
});

describe("Central service configuration", () => {
  it("fails with a clear not-configured error naming the first missing variable", async () => {
    const client = createCentralServiceClient({ fetch: (async () => json(200, {})) as FetchLike });
    const error = await client.accessCheck({ a: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CentralNotConfiguredError);
    expect((error as CentralNotConfiguredError).variable).toBe("TITAN_CENTRAL_ORIGIN");
  });

  it("reads every value from the environment map supplied", () => {
    const config = readServiceConfig({
      TITAN_CENTRAL_ORIGIN: "https://central.test.invalid",
      TITAN_CENTRAL_TOKEN_ENDPOINT: "https://auth.test.invalid/oidc/token",
      TITAN_CENTRAL_SERVICE_CLIENT_ID: "id",
      TITAN_CENTRAL_SERVICE_CLIENT_SECRET: "secret",
      TITAN_CENTRAL_PRODUCT_AUDIENCE: PRODUCT_AUD,
    });
    expect(config.audience).toBe(PRODUCT_AUD);
  });
});
