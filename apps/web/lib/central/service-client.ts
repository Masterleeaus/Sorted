/**
 * Server-to-server clients for Central. This file holds two clients that share
 * the same token-caching pattern but target different Central surfaces:
 *
 *   1. createServiceTokenProvider (identity and config service): client-credentials
 *      grant against the product audience (CENTRAL_SERVICE_AUDIENCE). Used by flags.
 *      The token is cached in memory until 60 seconds before it expires and is
 *      never logged.
 *
 *   2. createCentralServiceClient (Titan Central APIs, issue #39): client-credentials
 *      grant via TITAN_CENTRAL_* settings.
 *      - Caches the token and refreshes it before expiry (single-flight).
 *      - Refuses any token whose `aud` is not the Sorted product audience.
 *      - Never passes organisation_id, tenant or cohort. Central derives the tenant
 *        from the verified token and rejects those fields with 400.
 *      - Never logs or echoes token material. Errors carry status codes and codes only.
 *      Central verifies signature, audience and expiry. The local `aud` check here is
 *      a fail-fast guard, not the security boundary.
 */

import { decodeJwt } from "jose";
import { readCentralServiceConfig, readServiceConfig, type CentralServiceConfig, type EnvSource } from "./config";
import { fetchDiscovery, type FetchLike, type OidcDiscovery, OidcError } from "./oidc";

export type { FetchLike } from "./oidc";

// ---------------------------------------------------------------------------
// Identity and config service token provider
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Titan Central service client (issue #39)
// ---------------------------------------------------------------------------

export type ServiceClientConfig = Readonly<{
  origin: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  audience: string;
}>;

export type CentralServiceErrorCode =
  | "token_request_failed"
  | "token_malformed"
  | "token_audience_mismatch"
  | "unauthorized"
  | "forbidden"
  | "rejected_request"
  | "central_error"
  | "forbidden_tenant_parameter";

export class CentralServiceError extends Error {
  readonly code: CentralServiceErrorCode;
  readonly status?: number;

  constructor(code: CentralServiceErrorCode, status?: number) {
    super(status === undefined ? `Central call failed: ${code}` : `Central call failed: ${code} (HTTP ${status})`);
    this.name = "CentralServiceError";
    this.code = code;
    this.status = status;
  }
}

export type CentralServiceClientOptions = Readonly<{
  /** Defaults to reading TITAN_CENTRAL_* from the environment on first use. */
  config?: () => ServiceClientConfig;
  fetch?: FetchLike;
  /** Unix seconds. */
  now?: () => number;
}>;

/** Refresh this long before the token expires. */
const TOKEN_REFRESH_SKEW_SECONDS = 60;

const FORBIDDEN_TENANT_KEYS = new Set(["organisation_id", "organization_id", "tenant", "cohort"]);

type CachedToken = { token: string; expiresAt: number };

function assertNoTenantParameters(value: unknown, depth = 0): void {
  if (depth > 16 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoTenantParameters(item, depth + 1);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_TENANT_KEYS.has(key)) {
      throw new CentralServiceError("forbidden_tenant_parameter");
    }
    assertNoTenantParameters(nested, depth + 1);
  }
}

function audienceIncludes(aud: unknown, expected: string): boolean {
  if (typeof aud === "string") return aud === expected;
  return Array.isArray(aud) && aud.includes(expected);
}

export function createCentralServiceClient(options: CentralServiceClientOptions = {}) {
  const readConfig = options.config ?? (() => readServiceConfig());
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  let cached: CachedToken | null = null;
  let inflight: Promise<string> | null = null;

  function isFresh(token: CachedToken): boolean {
    return now() < token.expiresAt - TOKEN_REFRESH_SKEW_SECONDS;
  }

  async function fetchToken(config: ServiceClientConfig): Promise<CachedToken> {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const response = await doFetch(config.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "client_credentials", resource: config.audience }).toString(),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new CentralServiceError("token_request_failed", response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CentralServiceError("token_malformed");
    }
    const record = body as { access_token?: unknown; expires_in?: unknown };
    if (typeof record.access_token !== "string" || typeof record.expires_in !== "number" || record.expires_in <= 0) {
      throw new CentralServiceError("token_malformed");
    }

    let claims: ReturnType<typeof decodeJwt>;
    try {
      claims = decodeJwt(record.access_token);
    } catch {
      throw new CentralServiceError("token_malformed");
    }
    if (!audienceIncludes(claims.aud, config.audience)) {
      throw new CentralServiceError("token_audience_mismatch");
    }

    const issuedAt = now();
    let expiresAt = issuedAt + record.expires_in;
    if (typeof claims.exp === "number") expiresAt = Math.min(expiresAt, claims.exp);
    return { token: record.access_token, expiresAt };
  }

  /** Returns a valid token, refreshing before expiry. Concurrent callers share one request. */
  async function getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && cached && isFresh(cached)) return cached.token;
    if (!inflight) {
      inflight = (async () => {
        try {
          const next = await fetchToken(readConfig());
          cached = next;
          return next.token;
        } finally {
          inflight = null;
        }
      })();
    }
    return inflight;
  }

  /** Calls a Central endpoint with the service token. Path is relative to the configured origin. */
  async function request(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<unknown> {
    if (init.body !== undefined) assertNoTenantParameters(init.body);
    const config = readConfig();
    const url = new URL(path, config.origin).toString();

    const send = async (forceRefresh: boolean) => {
      const token = await getAccessToken(forceRefresh);
      return doFetch(url, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
      });
    };

    let response = await send(false);
    if (response.status === 401) {
      // Token may have been revoked or rotated. Retry once with a fresh token.
      cached = null;
      response = await send(true);
    }
    if (response.status === 401) throw new CentralServiceError("unauthorized", 401);
    if (response.status === 403) throw new CentralServiceError("forbidden", 403);
    if (response.status === 400) throw new CentralServiceError("rejected_request", 400);
    if (!response.ok) throw new CentralServiceError("central_error", response.status);

    return response.json();
  }

  /** POST /v1/access/check. The body must not contain tenant parameters. */
  function accessCheck(body: Record<string, unknown>): Promise<unknown> {
    return request("/v1/access/check", { method: "POST", body });
  }

  return { getAccessToken, request, accessCheck };
}

export type CentralServiceClient = ReturnType<typeof createCentralServiceClient>;
