import { describe, expect, it } from 'vitest';
import {
  EntitlementError,
  SORTED_CENTRAL_APPLICATION,
  createEntitlementReader,
  type EntitlementFetchLike,
} from './entitlements';

const ORG = '11111111-2222-4333-8444-555555555555';
const ORIGIN = 'https://central.test.invalid';
const TOKEN = 'stub-bearer-token';

type Call = { url: string; init?: RequestInit };

function stub(handler: (url: URL) => Response | Promise<Response> | never) {
  const calls: Call[] = [];
  const fetchFn: EntitlementFetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(new URL(url));
  };
  return { fetchFn, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const reader = (fetchFn: EntitlementFetchLike, accessToken = async () => TOKEN) =>
  createEntitlementReader({ origin: ORIGIN, accessToken, fetch: fetchFn });

describe('Sorted entitlement reader', () => {
  it('checks jobs:read and visits:read against the legacy Sorted application', async () => {
    const { fetchFn, calls } = stub(() => json(200, { allowed: true, role: 'member', reason: 'allowed' }));

    await reader(fetchFn).read(ORG);

    expect(calls).toHaveLength(2);
    const actions = calls.map((c) => new URL(c.url).searchParams.get('action')).sort();
    expect(actions).toEqual(['jobs:read', 'visits:read']);
    for (const call of calls) {
      const url = new URL(call.url);
      expect(url.pathname).toBe('/v1/access/check');
      expect(url.searchParams.get('organisation_id')).toBe(ORG);
      expect(url.searchParams.get('application')).toBe(SORTED_CENTRAL_APPLICATION);
      expect(call.init?.redirect).toBe('error');
      expect((call.init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it('reports allowed only for HTTP 200 with allowed true', async () => {
    const { fetchFn } = stub((url) =>
      url.searchParams.get('action') === 'jobs:read' ? json(200, { allowed: true }) : json(200, { allowed: false }),
    );

    const result = await reader(fetchFn).read(ORG);

    expect(result['jobs:read']).toEqual({ allowed: true, reason: 'allowed' });
    expect(result['visits:read']).toEqual({ allowed: false, reason: 'malformed_response' });
  });

  it('passes a safe 403 reason code through and denies', async () => {
    const { fetchFn } = stub(() => json(403, { allowed: false, role: null, reason: 'feature_denied' }));

    const result = await reader(fetchFn).read(ORG);

    expect(result['jobs:read']).toEqual({ allowed: false, reason: 'feature_denied' });
    expect(result['visits:read']).toEqual({ allowed: false, reason: 'feature_denied' });
  });

  it('replaces an unsafe 403 reason with a generic code', async () => {
    const { fetchFn } = stub(() => json(403, { allowed: false, reason: 'Some Free Text <script>' }));

    const result = await reader(fetchFn).read(ORG);

    expect(result['jobs:read'].reason).toBe('denied');
  });

  it('fails closed on 401, 5xx, network error and timeout-style errors', async () => {
    const unauth = await reader(stub(() => json(401, { error: 'unauthenticated' })).fetchFn).read(ORG);
    expect(unauth['jobs:read']).toEqual({ allowed: false, reason: 'unauthenticated' });

    const server = await reader(stub(() => json(503, { error: 'access_unavailable' })).fetchFn).read(ORG);
    expect(server['visits:read']).toEqual({ allowed: false, reason: 'http_503' });

    const network = await reader(
      stub(() => {
        throw new TypeError('fetch failed');
      }).fetchFn,
    ).read(ORG);
    expect(network['jobs:read']).toEqual({ allowed: false, reason: 'network_error' });
  });

  it('treats a non-JSON 200 response as unavailable, not allowed', async () => {
    const { fetchFn } = stub(() => new Response('<html>', { status: 200 }));

    const result = await reader(fetchFn).read(ORG);

    expect(result['jobs:read'].allowed).toBe(false);
    expect(result['visits:read'].allowed).toBe(false);
  });

  it('denies every capability without a network call when the token cannot be obtained', async () => {
    const { fetchFn, calls } = stub(() => json(200, { allowed: true }));
    const result = await reader(fetchFn, async () => {
      throw new Error('token store down');
    }).read(ORG);

    expect(calls).toHaveLength(0);
    expect(result['jobs:read']).toEqual({ allowed: false, reason: 'token_unavailable' });
  });

  it('refuses a malformed organisation id before any call', async () => {
    const { fetchFn, calls } = stub(() => json(200, { allowed: true }));

    await expect(reader(fetchFn).read('not-a-uuid; drop')).rejects.toBeInstanceOf(EntitlementError);
    await expect(reader(fetchFn).read('')).rejects.toMatchObject({ code: 'invalid_organisation' });
    expect(calls).toHaveLength(0);
  });

  it('refuses a non-https origin at construction', () => {
    expect(() => createEntitlementReader({ origin: 'http://central.example.invalid', accessToken: async () => TOKEN })).toThrowError(
      EntitlementError,
    );
  });
});
