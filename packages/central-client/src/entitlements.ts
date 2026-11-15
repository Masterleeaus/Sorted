/**
 * Entitlement reader for Sorted's two read capabilities, jobs:read and visits:read.
 *
 * Central answers each check with GET /v1/access/check?organisation_id=&application=&action=.
 * Only HTTP 200 with allowed === true yields allowed. Every other outcome (403, 401, timeout,
 * network error, malformed body, a token that cannot be obtained) yields allowed: false with a
 * reason code. The reader fails closed.
 *
 * The response body is never logged or returned, and reason codes are restricted to a safe pattern.
 */

/** Central's access route accepts the legacy product id. Sorted's legacy id is `field` (see central PRODUCT_DEFINITIONS). */
export const SORTED_CENTRAL_APPLICATION = 'field';

export const SORTED_CAPABILITIES = ['jobs:read', 'visits:read'] as const;
export type SortedCapability = (typeof SORTED_CAPABILITIES)[number];

export type CapabilityState = Readonly<{ allowed: boolean; reason: string }>;
export type SortedEntitlements = Readonly<Record<SortedCapability, CapabilityState>>;

export type EntitlementErrorCode = 'invalid_config' | 'invalid_organisation';

export class EntitlementError extends Error {
  readonly code: EntitlementErrorCode;

  constructor(code: EntitlementErrorCode) {
    super(`Central entitlement read failed: ${code}`);
    this.name = 'EntitlementError';
    this.code = code;
  }
}

export type EntitlementFetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type EntitlementReaderOptions = Readonly<{
  /** Central API origin, https (or http on localhost for tests). */
  origin: string;
  /** Central application id. Defaults to the legacy id for Sorted. */
  application?: string;
  /** Supplies the bearer token for the access check. Its value is never logged or returned. */
  accessToken: () => Promise<string>;
  fetch?: EntitlementFetchLike;
  /** Per-capability timeout in milliseconds. */
  timeoutMs?: number;
}>;

const ORGANISATION_ID = /^[a-f0-9-]{36}$/i;
const REASON_CODE = /^[a-z][a-z_]{0,39}$/;
const DEFAULT_TIMEOUT_MS = 5000;

function assertOrigin(origin: string): void {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new EntitlementError('invalid_config');
  }
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) {
    throw new EntitlementError('invalid_config');
  }
}

function unavailable(reason: string): CapabilityState {
  return Object.freeze({ allowed: false, reason });
}

export function createEntitlementReader(options: EntitlementReaderOptions) {
  assertOrigin(options.origin);
  const application = options.application ?? SORTED_CENTRAL_APPLICATION;
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(application)) throw new EntitlementError('invalid_config');
  const doFetch: EntitlementFetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function checkCapability(organisationId: string, capability: SortedCapability): Promise<CapabilityState> {
    let token: string;
    try {
      token = await options.accessToken();
    } catch {
      return unavailable('token_unavailable');
    }

    const url = new URL('/v1/access/check', options.origin);
    url.searchParams.set('organisation_id', organisationId);
    url.searchParams.set('application', application);
    url.searchParams.set('action', capability);

    let response: Response;
    try {
      response = await doFetch(url.toString(), {
        method: 'GET',
        redirect: 'error',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return unavailable('network_error');
    }

    if (response.status === 401) return unavailable('unauthenticated');

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const isObject = body !== null && typeof body === 'object';

    if (response.status === 200 && isObject && (body as { allowed?: unknown }).allowed === true) {
      return Object.freeze({ allowed: true, reason: 'allowed' });
    }
    if (response.status === 403 && isObject && (body as { allowed?: unknown }).allowed === false) {
      const reason = (body as { reason?: unknown }).reason;
      return Object.freeze({
        allowed: false,
        reason: typeof reason === 'string' && REASON_CODE.test(reason) ? reason : 'denied',
      });
    }
    return unavailable(response.status === 200 ? 'malformed_response' : `http_${response.status}`);
  }

  /** Reads jobs:read and visits:read for one organisation. Each capability is checked independently. */
  async function read(organisationId: string): Promise<SortedEntitlements> {
    if (!ORGANISATION_ID.test(organisationId)) throw new EntitlementError('invalid_organisation');
    const [jobs, visits] = await Promise.all(
      SORTED_CAPABILITIES.map((capability) => checkCapability(organisationId, capability)),
    );
    return Object.freeze({ 'jobs:read': jobs, 'visits:read': visits });
  }

  return { read };
}

export type EntitlementReader = ReturnType<typeof createEntitlementReader>;
