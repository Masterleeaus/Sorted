import { describe, expect, it, vi } from "vitest";
import { fetchDiscovery, type FetchLike } from "./discovery";
import { CentralClientError } from "./errors";
import { testConfig, TEST_ISSUER } from "./test-helpers";

function fakeFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): FetchLike {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  })) as unknown as FetchLike;
}

const goodDoc = {
  issuer: TEST_ISSUER,
  authorization_endpoint: "https://auth.example.test/oidc/auth",
  token_endpoint: "https://auth.example.test/oidc/token",
  jwks_uri: "https://elsewhere.example.test/jwks",
};

describe("fetchDiscovery", () => {
  it("loads endpoints from the issuer's well-known document and ignores metadata jwks_uri", async () => {
    const fetcher = fakeFetch(goodDoc);
    const result = await fetchDiscovery(testConfig(), fetcher);
    expect(fetcher).toHaveBeenCalledWith(`${TEST_ISSUER}/.well-known/openid-configuration`, expect.objectContaining({ redirect: "error" }));
    expect(result.authorizationEndpoint).toBe("https://auth.example.test/oidc/auth");
    expect(result.tokenEndpoint).toBe("https://auth.example.test/oidc/token");
  });

  it("rejects an issuer mismatch", async () => {
    await expect(fetchDiscovery(testConfig(), fakeFetch({ ...goodDoc, issuer: "https://other.example.test" }))).rejects.toMatchObject({
      code: "discovery_invalid",
    });
  });

  it("rejects endpoints outside the issuer origin", async () => {
    const doc = { ...goodDoc, token_endpoint: "https://attacker.example.test/token" };
    await expect(fetchDiscovery(testConfig(), fakeFetch(doc))).rejects.toMatchObject({ code: "discovery_invalid" });
  });

  it("rejects non-https endpoints", async () => {
    const doc = { ...goodDoc, authorization_endpoint: "http://auth.example.test/auth" };
    await expect(fetchDiscovery(testConfig(), fakeFetch(doc))).rejects.toMatchObject({ code: "discovery_invalid" });
  });

  it("fails on HTTP errors, non-JSON and oversized bodies", async () => {
    await expect(fetchDiscovery(testConfig(), fakeFetch("", { ok: false, status: 503 }))).rejects.toMatchObject({ code: "discovery_failed" });
    await expect(fetchDiscovery(testConfig(), fakeFetch("<html>"))).rejects.toMatchObject({ code: "discovery_invalid" });
    await expect(fetchDiscovery(testConfig(), fakeFetch("x".repeat(70 * 1024)))).rejects.toBeInstanceOf(CentralClientError);
  });
});
