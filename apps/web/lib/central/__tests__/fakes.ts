/** Test fakes only. Hosts use the reserved .test TLD and nothing here touches the network. */
import type { CentralOidcConfig } from "../config";
import type { OidcDiscovery } from "../oidc";

export const ORIGIN = "https://central.test";

export const DISCOVERY: OidcDiscovery = {
  issuer: `${ORIGIN}/oidc`,
  authorization_endpoint: `${ORIGIN}/oidc/auth`,
  token_endpoint: `${ORIGIN}/oidc/token`,
  jwks_uri: `${ORIGIN}/oidc/jwks`,
};

export const OIDC_CONFIG: CentralOidcConfig = {
  origin: ORIGIN,
  audience: "urn:test:sorted-app",
  clientId: "test-client-id",
  clientSecret: "test-client-secret-value",
  redirectUri: "https://sorted.test/auth/titan/callback",
};

interface RecordedCall {
  readonly url: string;
  readonly init?: RequestInit;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fn = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  };
  return { fn, calls };
}
