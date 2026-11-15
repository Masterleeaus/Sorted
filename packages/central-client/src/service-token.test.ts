import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SORTED_PRODUCT_AUDIENCE,
  REFRESH_MARGIN_SECONDS,
  ServiceTokenError,
  createServiceTokenClient,
  type FetchLike,
} from './service-token';

const ENDPOINT = 'https://auth.test.invalid/oidc/token';
const SECRET = 'stub-client-secret-value';
const CONFIG = { tokenEndpoint: ENDPOINT, clientId: 'stub-client-id', clientSecret: SECRET };
const NOW = 1_800_000_000;

function jwt(payload: Record<string, unknown>): string {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'EdDSA', typ: 'JWT' })}.${enc(payload)}.c2ln`;
}

const validToken = (exp = NOW + 3600, aud: unknown = SORTED_PRODUCT_AUDIENCE) => jwt({ aud, exp, sub: 'sorted-service' });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { url: string; init?: RequestInit };

function stub(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { fetchFn, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('service token client', () => {
  it('requests a client-credentials token for the Sorted audience with Basic auth and no secret in the body', async () => {
    const { fetchFn, calls } = stub(() => json(200, { access_token: validToken(), expires_in: 3600 }));
    const client = createServiceTokenClient({ config: CONFIG, fetch: fetchFn, now: () => NOW });

    await client.accessToken();

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(ENDPOINT);
    expect(call.init?.method).toBe('POST');
    expect(call.init?.redirect).toBe('error');
    const body = new URLSearchParams(String(call.init?.body));
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('audience')).toBe('urn:titan-central:product:sorted');
    expect(body.has('client_secret')).toBe(false);
    expect((call.init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`stub-client-id:${SECRET}`).toString('base64')}`,
    );
    expect(call.url).not.toContain(SECRET);
  });

  it('caches the token and does not request again before the refresh margin', async () => {
    let clock = NOW;
    const { fetchFn, calls } = stub(() => json(200, { access_token: validToken(NOW + 3600), expires_in: 1000 }));
    const client = createServiceTokenClient({ config: CONFIG, fetch: fetchFn, now: () => clock });

    const first = await client.accessToken();
    clock = NOW + 1000 - REFRESH_MARGIN_SECONDS - 1;
    const second = await client.accessToken();

    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
  });

  it('refreshes before expiry once the refresh margin is reached', async () => {
    let clock = NOW;
    const tokens = [validToken(NOW + 3600), validToken(NOW + 7200)];
    const { fetchFn, calls } = stub((_call, i) => json(200, { access_token: tokens[i], expires_in: 1000 }));
    const client = createServiceTokenClient({ config: CONFIG, fetch: fetchFn, now: () => clock });

    const first = await client.accessToken();
    clock = NOW + 1000 - REFRESH_MARGIN_SECONDS;
    const second = await client.accessToken();

    expect(second).not.toBe(first);
    expect(second).toBe(tokens[1]);
    expect(calls).toHaveLength(2);
  });

  it('caps the cached lifetime at the token exp claim when that is earlier than expires_in', async () => {
    let clock = NOW;
    const { fetchFn, calls } = stub(() => json(200, { access_token: validToken(NOW + 100), expires_in: 3600 }));
    const client = createServiceTokenClient({ config: CONFIG, fetch: fetchFn, now: () => clock });

    await client.accessToken();
    clock = NOW + 100 - REFRESH_MARGIN_SECONDS;
    await client.accessToken();

    expect(calls).toHaveLength(2);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const { fetchFn, calls } = stub(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return json(200, { access_token: validToken(), expires_in: 3600 });
    });
    const client = createServiceTokenClient({ config: CONFIG, fetch: fetchFn, now: () => NOW });

    const [a, b] = await Promise.all([client.accessToken(), client.accessToken()]);

    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
  });

  it('requests a new token after invalidate()', async () => {
    const tokens = [validToken(), validToken(NOW + 7200)];
    const { fetchFn, calls } = stub((_call, i) => json(200, { access_token: tokens[i], expires_in: 3600 }));
    const client = createServiceTokenClient({ config: CONFIG, fetch: fetchFn, now: () => NOW });

    await client.accessToken();
    client.invalidate();
    const next = await client.accessToken();

    expect(next).toBe(tokens[1]);
    expect(calls).toHaveLength(2);
  });

  it('refuses a token whose audience is not the Sorted audience', async () => {
    const { fetchFn } = stub(() => json(200, { access_token: validToken(NOW + 3600, 'urn:titan-central:product:scheduled'), expires_in: 3600 }));
    const client = createServiceTokenClient({ config: CONFIG, fetch: fetchFn, now: () => NOW });

    await expect(client.accessToken()).rejects.toMatchObject({ code: 'token_audience_mismatch' });
  });

  it('accepts an audience array that includes the Sorted audience', async () => {
    const { fetchFn } = stub(() =>
      json(200, { access_token: validToken(NOW + 3600, ['urn:titan-central:product:other', SORTED_PRODUCT_AUDIENCE]), expires_in: 3600 }),
    );
    const client = createServiceTokenClient({ config: CONFIG, fetch: fetchFn, now: () => NOW });

    await expect(client.accessToken()).resolves.toEqual(expect.any(String));
  });

  it('refuses an opaque (non-JWT) token', async () => {
    const { fetchFn } = stub(() => json(200, { access_token: 'opaque-token', expires_in: 3600 }));
    const client = createServiceTokenClient({ config: CONFIG, fetch: fetchFn, now: () => NOW });

    await expect(client.accessToken()).rejects.toMatchObject({ code: 'token_not_jwt' });
  });

  it('refuses an already expired token', async () => {
    const { fetchFn } = stub(() => json(200, { access_token: validToken(NOW - 1), expires_in: 3600 }));
    const client = createServiceTokenClient({ config: CONFIG, fetch: fetchFn, now: () => NOW });

    await expect(client.accessToken()).rejects.toMatchObject({ code: 'token_expired' });
  });

  it('fails with a code and status when Central does not issue a token, without echoing the body', async () => {
    const { fetchFn } = stub(() => json(401, { error: 'invalid_client', secret: SECRET }));
    const client = createServiceTokenClient({ config: CONFIG, fetch: fetchFn, now: () => NOW });

    const error = await client.accessToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceTokenError);
    expect((error as ServiceTokenError).code).toBe('token_request_failed');
    expect((error as ServiceTokenError).status).toBe(401);
    expect((error as Error).message).not.toContain(SECRET);
  });

  it('rejects an unusable response body', async () => {
    const { fetchFn } = stub(() => json(200, { access_token: '', expires_in: 3600 }));
    const client = createServiceTokenClient({ config: CONFIG, fetch: fetchFn, now: () => NOW });

    await expect(client.accessToken()).rejects.toMatchObject({ code: 'token_malformed' });
  });

  it('never writes the secret or the token to console', async () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m as 'log'));
    const token = validToken();
    const { fetchFn } = stub(() => json(200, { access_token: token, expires_in: 3600 }));
    const client = createServiceTokenClient({ config: CONFIG, fetch: fetchFn, now: () => NOW });
    await client.accessToken();
    await createServiceTokenClient({
      config: CONFIG,
      fetch: stub(() => json(500, {})).fetchFn,
      now: () => NOW,
    }).accessToken().catch(() => undefined);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a non-https token endpoint and empty credentials at construction', () => {
    expect(() => createServiceTokenClient({ config: { ...CONFIG, tokenEndpoint: 'http://auth.example.invalid/token' } })).toThrowError(
      ServiceTokenError,
    );
    expect(() => createServiceTokenClient({ config: { ...CONFIG, clientSecret: ' ' } })).toThrow(ServiceTokenError);
  });
});
