/**
 * Server-to-server calls to Central with the OAuth client-credentials grant.
 *
 * The token is requested for the product audience (CENTRAL_SERVICE_AUDIENCE),
 * cached in memory until 60 seconds before it expires, and never logged.
 */

import { readCentralServiceConfig, type CentralServiceConfig, type EnvSource } from "./config";
import { fetchDiscovery, type FetchLike, type OidcDiscovery, OidcError } from "./oidc";

const REFRESH_MARGIN_MS = 60_000;

interface ServiceClientDeps {
  readonly fetch: FetchLike;
  readonly now?: () => number;
  readonly env?: EnvSource;
}

export interface ServiceTokenProvider {
  getToken(): Promise<string>;
}

export function createServiceTokenProvider(
  deps: ServiceClientDeps,
  config: CentralServiceConfig = readCentralServiceConfig(deps.env ?? process.env),
): ServiceTokenProvider {
  const now = deps.now ?? Date.now;
  let discovery: Promise<OidcDiscovery> | null = null;
  let cached: { token: string; expiresAtMs: number } | null = null;

  return {
    async getToken(): Promise<string> {
      if (cached && now() < cached.expiresAtMs - REFRESH_MARGIN_MS) return cached.token;

      discovery ??= fetchDiscovery(config.origin, deps.fetch).catch((error: unknown) => {
        discovery = null;
        throw error;
      });
      const doc = await discovery;

      const credentials = Buffer.from(
        `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
      ).toString("base64");
      const res = await deps.fetch(doc.token_endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          audience: config.audience,
        }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new OidcError("service_token_failed", `service token endpoint answered HTTP ${res.status}`);
      const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
      if (typeof body.access_token !== "string" || body.access_token.length === 0) {
        throw new OidcError("service_token_failed", "service token response has no access_token");
      }
      if (typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
        throw new OidcError("service_token_failed", "service token response has no usable expires_in");
      }
      cached = { token: body.access_token, expiresAtMs: now() + body.expires_in * 1000 };
      return cached.token;
    },
  };
}
