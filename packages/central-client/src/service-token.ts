/**
 * Sorted's client-credentials service token for Titan Central.
 *
 * - Requests a token with the client-credentials grant, client id and secret in HTTP Basic auth.
 * - Audience is fixed to urn:titan-central:product:sorted and sent as the `audience` form field.
 * - Caches the token in memory and refreshes it REFRESH_MARGIN_SECONDS before expiry.
 *   Concurrent callers share one in-flight request.
 * - Refuses a token that is not a JWT, whose `aud` does not include the Sorted audience, or that is expired.
 *   The payload is read but its signature is not checked here: Central verifies the signature on every call.
 * - Never logs or throws the client secret, the token or the response body. Errors carry codes only.
 */

export const SORTED_PRODUCT_AUDIENCE = 'urn:titan-central:product:sorted';

/** Refresh this many seconds before the token expires. */
export const REFRESH_MARGIN_SECONDS = 60;

export type ServiceTokenConfig = Readonly<{
  /** Logto OIDC token endpoint. Must be https, or http on localhost for tests. */
  tokenEndpoint: string;
  clientId: string;
  /** Read from the secret store by the caller. Never written to logs, errors or fixtures. */
  clientSecret: string;
}>;

export type ServiceTokenErrorCode =
  | 'invalid_config'
  | 'token_request_failed'
  | 'token_malformed'
  | 'token_not_jwt'
  | 'token_audience_mismatch'
  | 'token_expired';

export class ServiceTokenError extends Error {
  readonly code: ServiceTokenErrorCode;
  readonly status?: number;

  constructor(code: ServiceTokenErrorCode, status?: number) {
    super(status === undefined ? `Central service token failed: ${code}` : `Central service token failed: ${code} (HTTP ${status})`);
    this.name = 'ServiceTokenError';
    this.code = code;
    this.status = status;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type ServiceTokenClientOptions = Readonly<{
  config: ServiceTokenConfig;
  fetch?: FetchLike;
  /** Unix seconds. Defaults to the system clock. */
  now?: () => number;
}>;

type CachedToken = Readonly<{ token: string; expiresAt: number }>;

function assertHttpsEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ServiceTokenError('invalid_config');
  }
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) {
    throw new ServiceTokenError('invalid_config');
  }
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new ServiceTokenError('token_not_jwt');
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new ServiceTokenError('token_malformed');
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ServiceTokenError('token_malformed');
  }
  return payload as Record<string, unknown>;
}

function audienceIncludes(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') return aud === expected;
  return Array.isArray(aud) && aud.includes(expected);
}

export function createServiceTokenClient(options: ServiceTokenClientOptions) {
  const { config } = options;
  assertHttpsEndpoint(config.tokenEndpoint);
  if (config.clientId.trim() === '' || config.clientSecret.trim() === '') {
    throw new ServiceTokenError('invalid_config');
  }
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  let cached: CachedToken | null = null;
  let inflight: Promise<string> | null = null;

  function isFresh(token: CachedToken): boolean {
    return now() < token.expiresAt - REFRESH_MARGIN_SECONDS;
  }

  async function requestToken(): Promise<CachedToken> {
    const response = await doFetch(config.tokenEndpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', audience: SORTED_PRODUCT_AUDIENCE }).toString(),
    });
    if (response.status !== 200) {
      throw new ServiceTokenError('token_request_failed', response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServiceTokenError('token_malformed');
    }
    const record = (body ?? {}) as { access_token?: unknown; expires_in?: unknown };
    if (
      typeof record.access_token !== 'string' ||
      record.access_token === '' ||
      typeof record.expires_in !== 'number' ||
      !Number.isInteger(record.expires_in) ||
      record.expires_in < 1
    ) {
      throw new ServiceTokenError('token_malformed');
    }

    const issuedAt = now();
    const claims = decodeJwtPayload(record.access_token);
    if (!audienceIncludes(claims.aud, SORTED_PRODUCT_AUDIENCE)) {
      throw new ServiceTokenError('token_audience_mismatch');
    }
    if (typeof claims.exp !== 'number' || claims.exp <= issuedAt) {
      throw new ServiceTokenError('token_expired');
    }
    return {
      token: record.access_token,
      expiresAt: Math.min(issuedAt + record.expires_in, claims.exp),
    };
  }

  /** Returns a valid service token, refreshing it before expiry. */
  async function accessToken(): Promise<string> {
    if (cached !== null && isFresh(cached)) return cached.token;
    if (inflight === null) {
      inflight = (async () => {
        try {
          const next = await requestToken();
          cached = next;
          return next.token;
        } finally {
          inflight = null;
        }
      })();
    }
    return inflight;
  }

  /** Drops the cached token, for example after Central answers 401. The next call requests a new one. */
  function invalidate(): void {
    cached = null;
  }

  return { accessToken, invalidate, audience: SORTED_PRODUCT_AUDIENCE };
}

export type ServiceTokenClient = ReturnType<typeof createServiceTokenClient>;
