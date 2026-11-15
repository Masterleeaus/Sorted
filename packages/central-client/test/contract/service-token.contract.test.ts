import { afterEach, beforeEach, describe, expect } from "vitest";
import { config } from "./support/fixtures";
import { contractTest, requireExport } from "./support/public-api";
import { startStubCentral, type StubCentral } from "./support/central-stub";
import { keyByLabel } from "./support/link-cases";

/**
 * Service client contract: Logto client-credentials token, audience check, cache
 * and refresh, single-flight, error mapping, and the tenant-parameter guard.
 * Pending until packages/central-client exports createCentralServiceClient and CentralServiceError.
 */

const test = contractTest(["createCentralServiceClient", "CentralServiceError"]);

type ServiceClient = {
  getAccessToken: (forceRefresh?: boolean) => Promise<string>;
  request: (path: string, init: { method: "GET" | "POST"; body?: unknown }) => Promise<unknown>;
};

describe("service token contract", () => {
  let central: StubCentral;
  let clock: { nowSeconds: number };
  const serviceConfig = config.serviceClient;

  beforeEach(async () => {
    clock = { nowSeconds: config.clockEpochSeconds };
    central = await startStubCentral({
      clock,
      tokenKey: keyByLabel(serviceConfig.tokenKeyLabel),
      tokenKid: "central-token-contract-2026",
      tokenIssuer: serviceConfig.tokenIssuer,
      tokenPath: serviceConfig.tokenPath,
      clientId: serviceConfig.clientId,
      clientSecret: serviceConfig.clientSecret,
      defaultAudience: serviceConfig.audience,
      tokenTtlSeconds: serviceConfig.tokenTtlSeconds,
    });
  });

  afterEach(async () => {
    await central.close();
  });

  function makeClient(): ServiceClient {
    const create = requireExport<(options: object) => ServiceClient>("createCentralServiceClient");
    return create({
      config: () => ({
        origin: central.origin,
        tokenEndpoint: `${central.origin}${serviceConfig.tokenPath}`,
        clientId: serviceConfig.clientId,
        clientSecret: serviceConfig.clientSecret,
        audience: serviceConfig.audience,
      }),
      now: () => clock.nowSeconds,
    });
  }

  test("requests a token with client credentials for the product audience", async () => {
    const client = makeClient();
    await client.getAccessToken();
    expect(central.tokenRequests).toHaveLength(1);
    const [request] = central.tokenRequests;
    expect(request?.method).toBe("POST");
    expect(request?.authorization).toBe(
      `Basic ${Buffer.from(`${serviceConfig.clientId}:${serviceConfig.clientSecret}`).toString("base64")}`,
    );
    expect(request?.form.grant_type).toBe("client_credentials");
    expect(request?.form.resource).toBe(serviceConfig.audience);
  });

  test("reuses the cached token until 60 seconds before expiry", async () => {
    const client = makeClient();
    await client.getAccessToken();
    clock.nowSeconds += serviceConfig.tokenTtlSeconds - 61;
    await client.getAccessToken();
    expect(central.tokenRequests).toHaveLength(1);
    clock.nowSeconds += 1;
    await client.getAccessToken();
    expect(central.tokenRequests).toHaveLength(2);
  });

  test("shares one token request between concurrent callers", async () => {
    const client = makeClient();
    const tokens = await Promise.all([1, 2, 3, 4, 5].map(() => client.getAccessToken()));
    expect(new Set(tokens).size).toBe(1);
    expect(central.tokenRequests).toHaveLength(1);
  });

  test("refuses a token issued for another product audience", async () => {
    central.onToken = (_request, issue) => ({
      status: 200,
      body: { access_token: issue(serviceConfig.otherAudience), token_type: "Bearer", expires_in: 300 },
    });
    await expect(makeClient().getAccessToken()).rejects.toMatchObject({ code: "token_audience_mismatch" });
  });

  test("maps a token endpoint refusal to token_request_failed with its status", async () => {
    central.onToken = () => ({ status: 500, body: { error: "server_error" } });
    await expect(makeClient().getAccessToken()).rejects.toMatchObject({ code: "token_request_failed", status: 500 });
  });

  test("refuses a non-JSON token response as token_malformed", async () => {
    central.onToken = () => ({ status: 200, raw: "<html>not json</html>" });
    await expect(makeClient().getAccessToken()).rejects.toMatchObject({ code: "token_malformed" });
  });

  test("refuses a token response without a numeric expires_in as token_malformed", async () => {
    central.onToken = (_request, issue) => ({ status: 200, body: { access_token: issue(), token_type: "Bearer" } });
    await expect(makeClient().getAccessToken()).rejects.toMatchObject({ code: "token_malformed" });
  });

  test("sends the bearer token and returns the parsed JSON body", async () => {
    const client = makeClient();
    const body = await client.request("/v1/access/check", { method: "POST", body: { action: "read" } });
    expect(body).toEqual({ ok: true });
    const [api] = central.apiRequests;
    expect(api?.authorization?.startsWith("Bearer ")).toBe(true);
    expect(api?.body).toEqual({ action: "read" });
  });

  test("retries once with a fresh token after a 401, then succeeds", async () => {
    let calls = 0;
    central.onApi = (_request, valid) => {
      calls += 1;
      return calls === 1 ? { status: 401 } : valid ? { status: 200, body: { ok: true } } : { status: 401 };
    };
    const body = await makeClient().request("/v1/access/check", { method: "POST", body: {} });
    expect(body).toEqual({ ok: true });
    expect(central.apiRequests).toHaveLength(2);
    expect(central.tokenRequests).toHaveLength(2);
  });

  test("maps 403, 400 and 500 from Central to forbidden, rejected_request and central_error", async () => {
    const client = makeClient();
    central.onApi = () => ({ status: 403 });
    await expect(client.request("/v1/x", { method: "POST", body: {} })).rejects.toMatchObject({ code: "forbidden", status: 403 });
    central.onApi = () => ({ status: 400 });
    await expect(client.request("/v1/x", { method: "POST", body: {} })).rejects.toMatchObject({ code: "rejected_request", status: 400 });
    central.onApi = () => ({ status: 500 });
    await expect(client.request("/v1/x", { method: "POST", body: {} })).rejects.toMatchObject({ code: "central_error", status: 500 });
  });

  test("refuses tenant parameters before any HTTP call", async () => {
    const client = makeClient();
    await expect(client.request("/v1/x", { method: "POST", body: { organisation_id: "org_other" } })).rejects.toMatchObject({
      code: "forbidden_tenant_parameter",
    });
    expect(central.tokenRequests).toHaveLength(0);
    expect(central.apiRequests).toHaveLength(0);
  });
});
