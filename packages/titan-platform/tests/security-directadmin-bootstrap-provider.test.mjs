import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, jwtVerify } from 'jose';
import { tsImport } from 'tsx/esm/api';

const { createDirectAdminBootstrapAssertionProvider, createSessionCredentialService, directAdminIssuer } =
  await tsImport('../src/security-session-credentials.ts', { parentURL: import.meta.url, tsconfig: false });
const { createIdentitySessionRegistry } =
  await tsImport('../src/security-session-registry.ts', { parentURL: import.meta.url, tsconfig: false });
const { createSqliteStorage } = await tsImport('@titan-zero/storage', { parentURL: import.meta.url, tsconfig: false });

const ORIGIN = 'https://da.example.test:2222';
const ISSUER = directAdminIssuer(ORIGIN);
const NOW = new Date('2026-10-02T15:30:00.000Z');
const proof = nonce => ({
  origin: ORIGIN,
  cookie: 'session=test-only-session; key=test-only-key',
  authorization: null,
  csrf_nonce: nonce,
});
const apiSession = (changes = {}) => ({
  effectiveRole: 'admin',
  effectiveUsername: 'effective-user',
  realUsername: 'operator-admin',
  // Host-specific configuration fields are not identity inputs.
  allowedCommands: ['CMD_USER_STATS'],
  directadminConfig: { api: true },
  ...changes,
});
const response = (body, status = 200, contentType = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });

async function setupProvider(t, overrides = {}) {
  const keys = await generateKeyPair('EdDSA');
  const trust = { issuer: ISSUER, audience: 'titan-login', key_id: 'test-da-issuer', algorithm: 'EdDSA', verification_key: keys.publicKey };
  const consumed = new Set();
  const resolved = [];
  let fetchCalls = 0;
  let fetchResponse = () => response(apiSession());
  let optionsSeen;
  const provider = createDirectAdminBootstrapAssertionProvider({
    origin: ORIGIN,
    node_id: 'da-node-test',
    upstream: trust,
    signing_key: keys.privateKey,
    now: () => NOW,
    consumePreAuthNonce: async input => {
      resolved.push(input);
      if (consumed.has(input.csrf_nonce)) return null;
      consumed.add(input.csrf_nonce);
      return { company_id: 'company-a', device_id: 'device-test' };
    },
    fetcher: async (url, init) => {
      fetchCalls++;
      optionsSeen = { url: String(url), init };
      return typeof fetchResponse === 'function' ? fetchResponse() : fetchResponse;
    },
    ...overrides,
  });
  return {
    provider, keys, trust, resolved, consumed,
    get fetchCalls() { return fetchCalls; },
    get optionsSeen() { return optionsSeen; },
    setFetchResponse(value) { fetchResponse = () => value; },
  };
}

test('verifies DirectAdmin session, consumes nonce context, and signs the exact bootstrap contract', async t => {
  const f = await setupProvider(t);
  const nonce = 'pre-auth-nonce-for-this-test-000000000000000000000000';
  const issued = await f.provider.provide(proof(nonce));

  assert.deepEqual(Object.keys(issued).sort(), ['company_id', 'csrf_token', 'device_id', 'login_assertion']);
  assert.equal(issued.company_id, 'company-a');
  assert.equal(issued.device_id, 'device-test');
  assert.match(issued.csrf_token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(f.fetchCalls, 1);
  assert.equal(f.optionsSeen.url, `${ORIGIN}/api/session`);
  assert.equal(f.optionsSeen.init.method, 'GET');
  assert.equal(f.optionsSeen.init.headers.cookie, proof(nonce).cookie);
  assert.equal(f.optionsSeen.init.headers.authorization, undefined);
  assert.equal(f.optionsSeen.init.redirect, 'error');
  assert.equal(f.optionsSeen.init.cache, 'no-store');
  assert.equal(f.optionsSeen.init.credentials, 'omit');
  assert.deepEqual(f.resolved[0], {
    issuer: ISSUER,
    subject: 'effective-user',
    real_subject: 'operator-admin',
    da_role: 'admin',
    impersonating: true,
    csrf_nonce: nonce,
  });

  const { payload, protectedHeader } = await jwtVerify(issued.login_assertion, f.keys.publicKey, {
    algorithms: ['EdDSA'], issuer: ISSUER, audience: 'titan-login',
    typ: 'titan-login+jwt', currentDate: NOW, clockTolerance: 0,
  });
  assert.deepEqual(protectedHeader, { alg: 'EdDSA', kid: 'test-da-issuer', typ: 'titan-login+jwt' });
  assert.equal(payload.sub, 'effective-user');
  assert.equal(payload.real_sub, 'operator-admin');
  assert.equal(payload.da_impersonating, true);
  assert.equal(payload.da_role, 'admin');
  assert.equal(payload.company_id, 'company-a');
  assert.equal(payload.device_id, 'device-test');
  assert.equal(payload.node_id, 'da-node-test');
  assert.equal(payload.csrf_sha256, Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(issued.csrf_token))).toString('base64url'));
  assert.match(payload.jti, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(payload.iat, Math.floor(NOW.getTime() / 1000));
  assert.equal(payload.exp - payload.iat, 300);
  assert.equal('allowed_company_ids' in payload, false);
  assert.equal('actor_id' in payload, false);
});

test('an unauthenticated proof, Basic Authorization, or replayed pre-auth nonce fails before assertions', async t => {
  const f = await setupProvider(t);
  const valid = proof('pre-auth-nonce-for-this-test-000000000000000000000000');

  await assert.rejects(f.provider.provide({ ...valid, origin: 'https://attacker.example.test' }), { message: 'authentication-denied' });
  await assert.rejects(f.provider.provide({ ...valid, cookie: null }), { message: 'authentication-denied' });
  await assert.rejects(f.provider.provide({ ...valid, authorization: 'Basic test-only' }), { message: 'authentication-denied' });
  assert.equal(f.fetchCalls, 0);
  const first = await f.provider.provide(valid);
  await assert.rejects(f.provider.provide(valid), { message: 'authentication-denied' });
  assert.equal(f.fetchCalls, 2);
  assert.notEqual(first.login_assertion, '');
});

test('bootstrap provider forwards only one canonical session/key cookie pair', async t => {
  const f = await setupProvider(t);
  const nonce = 'pre-auth-nonce-for-this-test-000000000000000000000000';
  for (const cookie of [
    'session=a; key=b; analytics=c',
    'session=a; session=b; key=c',
    'session=a; key=b; key=c',
    'session=a',
    'session="quoted"; key=b',
    'session=a; key=b; __Host-titan-da-session=titan-value',
    'session=a; key=b\r\nAuthorization: Basic test',
    `session=${'a'.repeat(8192)}; key=b`,
  ]) {
    await assert.rejects(f.provider.provide({ ...proof(nonce), cookie }), { message: 'authentication-denied' });
  }
  assert.equal(f.fetchCalls, 0);

  const accepted = { ...proof(nonce), cookie: ' key=test-only=key ; session=test-only-session ' };
  await f.provider.provide(accepted);
  assert.equal(f.optionsSeen.init.headers.cookie, 'session=test-only-session; key=test-only=key');
});

for (const [label, replacement, error] of [
  ['unauthenticated DA cookie', response({}, 401), 'authentication-denied'],
  ['unsupported content type', response(apiSession(), 200, 'text/html'), 'directadmin-session-schema-unsupported'],
  ['missing identity field', response({ effectiveRole: 'user', effectiveUsername: 'user' }), 'directadmin-session-schema-unsupported'],
  ['unsupported DA role', response(apiSession({ effectiveRole: 'root' })), 'directadmin-session-schema-unsupported'],
  ['service outage', response({}, 500), 'directadmin-service-unavailable'],
]) {
  test(`fails closed on DirectAdmin bootstrap response: ${label}`, async t => {
    const f = await setupProvider(t);
    f.setFetchResponse(replacement);
    await assert.rejects(f.provider.provide(proof('pre-auth-nonce-for-this-test-000000000000000000000000')), { message: error });
    assert.equal(f.resolved.length, 0);
  });
}

test('does not accept multi-company or accessor-backed selection results', async t => {
  for (const badSelection of [
    { company_id: 'company-a', device_id: 'device-test', allowed_company_ids: ['company-a', 'company-b'] },
    Object.defineProperties({}, {
      company_id: { enumerable: true, get() { throw new Error('must-not-run'); } },
      device_id: { enumerable: true, value: 'device-test' },
    }),
  ]) {
    const f = await setupProvider(t, { consumePreAuthNonce: async () => badSelection });
    await assert.rejects(f.provider.provide(proof('pre-auth-nonce-for-this-test-000000000000000000000000')), { message: 'authentication-denied' });
  }
});

test('assertion exchanges once into the durable registry, derives role from membership, and rejects replay after restart', async t => {
  const f = await setupProvider(t);
  const directory = await mkdtemp(join(tmpdir(), 'titan-da-bootstrap-'));
  const database = join(directory, 'identity.sqlite');
  let storage = createSqliteStorage(database);
  let registry = await createIdentitySessionRegistry({ storage, storage_role: 'GLOBAL_REGISTRY' });
  const nodeKeys = await generateKeyPair('EdDSA');
  const policy = {
    issuer: 'titan:node-test', audience: 'titan-session', key_id: 'test-titan-session', algorithm: 'EdDSA',
    signing_key: nodeKeys.privateKey, verification_key: nodeKeys.publicKey,
    upstream: f.trust, directadmin: { node_id: 'da-node-test' }, registry, now: () => NOW,
  };
  let sessions = createSessionCredentialService(policy);
  try {
    await registry.putActor({ actor_id: 'actor-a', status: 'active' }, null);
    await registry.putDevice({ device_id: 'device-test', actor_id: 'actor-a', status: 'active' }, null);
    await registry.putCompany({ company_id: 'company-a', status: 'active' }, null);
    await registry.putMembership({ actor_id: 'actor-a', company_id: 'company-a', role: 'tech', status: 'active' }, null);
    await registry.putExternalBinding({ binding_id: 'binding-a', provider: ISSUER, subject: 'effective-user', actor_id: 'actor-a', company_id: 'company-a', status: 'active' }, null);
    const assertion = await f.provider.provide(proof('pre-auth-nonce-for-durable-test-00000000000000000000'));
    const issued = await sessions.issue(assertion.login_assertion, { company_id: assertion.company_id, device_id: assertion.device_id });
    const authenticated = await sessions.authenticate(issued.credential, { company_id: 'company-a', device_id: 'device-test' });
    assert.equal(authenticated.context.actor_id, 'actor-a');
    assert.equal(authenticated.context.company_role, 'tech');
    assert.equal(authenticated.subject, 'effective-user');
    assert.deepEqual(authenticated.directadmin, {
      node_id: 'da-node-test',
      csrf_sha256: (await jwtVerify(assertion.login_assertion, f.keys.publicKey, { algorithms: ['EdDSA'], currentDate: NOW })).payload.csrf_sha256,
      da_role: 'admin',
      real_subject: 'operator-admin',
      da_impersonating: true,
    });
    await assert.rejects(sessions.issue(assertion.login_assertion, { company_id: 'company-a', device_id: 'device-test' }), { message: 'authentication-denied' });

    await storage.close();
    storage = createSqliteStorage(database);
    registry = await createIdentitySessionRegistry({ storage, storage_role: 'GLOBAL_REGISTRY' });
    sessions = createSessionCredentialService({ ...policy, registry });
    await assert.rejects(sessions.issue(assertion.login_assertion, { company_id: 'company-a', device_id: 'device-test' }), { message: 'authentication-denied' });
  } finally {
    await storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});
