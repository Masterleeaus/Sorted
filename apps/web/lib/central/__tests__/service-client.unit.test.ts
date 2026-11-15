import { describe, it, expect } from "vitest";
import { createServiceTokenProvider } from "../service-client";
import type { CentralServiceConfig } from "../config";
import { DISCOVERY, ORIGIN, fakeFetch, jsonResponse } from "./fakes";

const SERVICE: CentralServiceConfig = {
  origin: ORIGIN,
  audience: "urn:test:product:sorted",
  clientId: "test-service-id",
  clientSecret: "test-service-secret-value",
};

function clock(start: number) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("service token provider (client credentials)", () => {
  it("requests a product-audience token and caches it until near expiry", async () => {
    const c = clock(1_000_000);
    const { fn, calls } = fakeFetch((url) =>
      url.endsWith("/.well-known/openid-configuration")
        ? jsonResponse(DISCOVERY)
        : jsonResponse({ access_token: "svc-token-1", expires_in: 300 }),
    );
    const provider = createServiceTokenProvider({ fetch: fn, now: c.now }, SERVICE);

    expect(await provider.getToken()).toBe("svc-token-1");
    expect(await provider.getToken()).toBe("svc-token-1");
    expect(calls.filter((x) => x.url === DISCOVERY.token_endpoint)).toHaveLength(1);

    const tokenCall = calls.find((x) => x.url === DISCOVERY.token_endpoint);
    const body = new URLSearchParams(String(tokenCall?.init?.body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("audience")).toBe("urn:test:product:sorted");
    expect(body.has("client_secret")).toBe(false);
  });

  it("refreshes once the cached token is within 60 seconds of expiry", async () => {
    const c = clock(0);
    let n = 0;
    const { fn, calls } = fakeFetch((url) =>
      url.endsWith("/.well-known/openid-configuration")
        ? jsonResponse(DISCOVERY)
        : jsonResponse({ access_token: `svc-token-${++n}`, expires_in: 300 }),
    );
    const provider = createServiceTokenProvider({ fetch: fn, now: c.now }, SERVICE);
    expect(await provider.getToken()).toBe("svc-token-1");
    c.advance(241_000);
    expect(await provider.getToken()).toBe("svc-token-2");
    expect(calls.filter((x) => x.url === DISCOVERY.token_endpoint)).toHaveLength(2);
    expect(calls.filter((x) => x.url.endsWith("openid-configuration"))).toHaveLength(1);
  });

  it("fails with a code and no secret or body when the token endpoint refuses", async () => {
    const c = clock(0);
    const { fn } = fakeFetch((url) =>
      url.endsWith("/.well-known/openid-configuration")
        ? jsonResponse(DISCOVERY)
        : new Response("refused-body-value", { status: 401 }),
    );
    const provider = createServiceTokenProvider({ fetch: fn, now: c.now }, SERVICE);
    const err = (await provider.getToken().catch((e: unknown) => e)) as Error & { code?: string };
    expect(err.code).toBe("service_token_failed");
    expect(err.message).not.toContain("refused-body-value");
    expect(err.message).not.toContain(SERVICE.clientSecret);
  });

  it("refuses a token response with no usable expiry", async () => {
    const c = clock(0);
    const { fn } = fakeFetch((url) =>
      url.endsWith("/.well-known/openid-configuration")
        ? jsonResponse(DISCOVERY)
        : jsonResponse({ access_token: "t" }),
    );
    const provider = createServiceTokenProvider({ fetch: fn, now: c.now }, SERVICE);
    await expect(provider.getToken()).rejects.toMatchObject({ code: "service_token_failed" });
  });
});
