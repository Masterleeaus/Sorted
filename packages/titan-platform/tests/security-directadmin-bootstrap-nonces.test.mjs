import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from 'jose';
import { tsImport } from 'tsx/esm/api';

const security = await tsImport('../.test-dist/security-boundary.js', { parentURL: import.meta.url, tsconfig: false });
const { createSqliteStorage } = await tsImport('@titan-zero/storage', { parentURL: import.meta.url, tsconfig: false });

const ORIGIN = 'https://da.example.test:2222';
const ISSUER = security.directAdminIssuer(ORIGIN);
const NOW = '2026-10-02T15:30:00.000Z';
const COOKIE = 'session=test-only-session; key=test-only-key';
const apiSession = (username = 'effective-user', realUsername = 'operator-admin', effectiveRole = 'admin') => ({
  effectiveRole, effectiveUsername: username, realUsername,
});
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

async function store(path = ':memory:', now = () => new Date(NOW)) {
  const storage = createSqliteStorage(path);
  const registry = await security.createIdentitySessionRegistry({ storage, storage_role: 'GLOBAL_REGISTRY', now });
  return { storage, registry };
}

async function enableNonceStore(storage) {
  await security.initializeDirectAdminBootstrapNonceStore({ storage, storage_role: 'GLOBAL_REGISTRY' });
}

async function provision(registry) {
  await registry.putActor({ actor_id: 'actor-a', status: 'active' }, null);
  await registry.putCompany({ company_id: 'company-a', status: 'active' }, null);
  await registry.putCompany({ company_id: 'company-b', status: 'active' }, null);
  await registry.putMembership({ actor_id: 'actor-a', company_id: 'company-a', role: 'owner', status: 'active' }, null);
  await registry.putMembership({ actor_id: 'actor-a', company_id: 'company-b', role: 'tech', status: 'active' }, null);
  await registry.putDevice({ device_id: 'device-a', actor_id: 'actor-a', status: 'active' }, null);
  await registry.putDevice({ device_id: 'device-b', actor_id: 'actor-a', status: 'active' }, null);
  await registry.putExternalBinding({ binding_id: 'binding-a', provider: ISSUER, subject: 'effective-user',
    actor_id: 'actor-a', company_id: 'company-a', status: 'active' }, null);
  await registry.putExternalBinding({ binding_id: 'binding-b', provider: ISSUER, subject: 'effective-user',
    actor_id: 'actor-a', company_id: 'company-b', status: 'active' }, null);
}

async function provisionUnique(registry) {
  await registry.putActor({ actor_id: 'actor-a', status: 'active' }, null);
  await registry.putCompany({ company_id: 'company-a', status: 'active' }, null);
  await registry.putMembership({ actor_id: 'actor-a', company_id: 'company-a', role: 'owner', status: 'active' }, null);
  await registry.putDevice({ device_id: 'device-a', actor_id: 'actor-a', status: 'active' }, null);
  await registry.putExternalBinding({ binding_id: 'binding-a', provider: ISSUER, subject: 'effective-user',
    actor_id: 'actor-a', company_id: 'company-a', status: 'active' }, null);
}

function issueProof(changes = {}) {
  return { origin: ORIGIN, cookie: COOKIE, authorization: null,
    company_id: 'company-a', device_id: 'device-a', ...changes };
}

function consumeProof(nonce, changes = {}) {
  return { origin: ORIGIN, issuer: ISSUER, subject: 'effective-user', real_subject: 'operator-admin',
    da_role: 'admin', impersonating: true, csrf_nonce: nonce, ...changes };
}

function registryIssue(changes = {}) {
  return { origin: ORIGIN, subject: 'effective-user', real_subject: 'operator-admin', da_role: 'admin',
    impersonating: true, company_id: 'company-a', device_id: 'device-a', ...changes };
}

test('nonce storage is a separately versioned explicit GLOBAL_REGISTRY add-on', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  const before = (await storage.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).rows.map(row => row.name);
  assert.equal(before.includes('titan_security_directadmin_bootstrap_nonces'), false);
  assert.deepEqual((await storage.query('SELECT version FROM titan_security_migrations')).rows, [{ version: 1 }]);
  await assert.rejects(registry.issueDirectAdminBootstrapNonce(registryIssue()));

  await enableNonceStore(storage);
  await enableNonceStore(storage);
  assert.deepEqual((await storage.query('SELECT version FROM titan_security_migrations')).rows, [{ version: 1 }]);
  assert.deepEqual((await storage.query('SELECT version FROM titan_security_directadmin_nonce_migrations')).rows, [{ version: 2 }]);
  assert.equal((await storage.query("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE 'titan_security_directadmin_%'")).rows[0].count, 2);
});

test('nonce add-on refuses unsupported or partially pre-existing schemas', async t => {
  const unsupported = await store();
  t.after(() => unsupported.storage.close());
  await enableNonceStore(unsupported.storage);
  await unsupported.storage.query('UPDATE titan_security_directadmin_nonce_migrations SET version=99');
  await assert.rejects(enableNonceStore(unsupported.storage), /nonce-schema-unsupported/);

  const partial = await store();
  t.after(() => partial.storage.close());
  await partial.storage.query('CREATE TABLE titan_security_directadmin_bootstrap_nonces (legacy_marker TEXT)');
  await assert.rejects(enableNonceStore(partial.storage), /nonce-schema-version-missing/);
  assert.deepEqual((await partial.storage.query('SELECT legacy_marker FROM titan_security_directadmin_bootstrap_nonces')).rows, []);
});

test('the earlier local v1 nonce add-on is not silently upgraded to the operator-bound v2 schema', async t => {
  const { storage } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await storage.query('UPDATE titan_security_directadmin_nonce_migrations SET version=1');
  await assert.rejects(enableNonceStore(storage), /nonce-schema-unsupported/);
  assert.deepEqual((await storage.query('SELECT version FROM titan_security_directadmin_nonce_migrations')).rows, [{ version: 1 }]);
});

test('issue stores only the nonce digest and binds one validated company/device context', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provision(registry);

  const issued = await registry.issueDirectAdminBootstrapNonce(registryIssue({ company_id: 'company-b', device_id: 'device-b' }));
  assert.deepEqual(Object.keys(issued).sort(), ['csrf_nonce', 'expires_at']);
  assert.match(issued.csrf_nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.expires_at, '2026-10-02T15:32:00.000Z');
  const rows = (await storage.query('SELECT * FROM titan_security_directadmin_bootstrap_nonces')).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nonce_hash, createHash('sha256').update(issued.csrf_nonce).digest('hex'));
  assert.equal(JSON.stringify(rows).includes(issued.csrf_nonce), false);
  assert.equal(rows[0].issuer, ISSUER);
  assert.equal(rows[0].subject, 'effective-user');
  assert.equal(rows[0].real_subject, 'operator-admin');
  assert.equal(rows[0].da_role, 'admin');
  assert.equal(rows[0].impersonating, 1);
  assert.equal(rows[0].origin, ORIGIN);
  assert.equal(rows[0].actor_id, 'actor-a');
  assert.equal(rows[0].company_id, 'company-b');
  assert.equal(rows[0].device_id, 'device-b');
  assert.ok(rows[0].context_generation.includes('binding-b'));
});

test('first-session issuer authenticates DirectAdmin and atomically resolves one canonical company/device', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provisionUnique(registry);
  const keys = await generateKeyPair('EdDSA');
  const trust = { issuer: ISSUER, audience: 'titan-login', key_id: 'test-da', algorithm: 'EdDSA', verification_key: keys.publicKey };
  let fetchCalls = 0;
  const flow = security.createDirectAdminBootstrapFlow({ origin: ORIGIN, node_id: 'node-a', upstream: trust,
    signing_key: keys.privateKey, registry, now: () => new Date(NOW),
    fetcher: async url => { fetchCalls++; assert.equal(String(url), `${ORIGIN}/api/session`); return response(apiSession()); } });

  await assert.rejects(flow.issueNonceForUniqueCurrentContext({ origin: ORIGIN, cookie: null, authorization: null }),
    { message: 'authentication-denied' });
  await assert.rejects(flow.issueNonceForUniqueCurrentContext({ origin: ORIGIN, cookie: COOKIE, authorization: null,
    company_id: 'caller-chosen-company' }), { message: 'authentication-denied' });
  assert.equal(fetchCalls, 0);
  const issued = await flow.issueNonceForUniqueCurrentContext({ origin: ORIGIN, cookie: COOKIE, authorization: null });
  assert.deepEqual({ company_id: issued.company_id, device_id: issued.device_id },
    { company_id: 'company-a', device_id: 'device-a' });
  assert.match(issued.csrf_nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(fetchCalls, 1);
  const row = (await storage.query('SELECT company_id,device_id,context_generation FROM titan_security_directadmin_bootstrap_nonces')).rows[0];
  assert.deepEqual({ company_id: row.company_id, device_id: row.device_id },
    { company_id: 'company-a', device_id: 'device-a' });
  assert.ok(row.context_generation.includes('binding-a'));
  const assertion = await flow.provide({ origin: ORIGIN, cookie: COOKIE, authorization: null, csrf_nonce: issued.csrf_nonce });
  assert.equal(assertion.company_id, issued.company_id);
  assert.equal(assertion.device_id, issued.device_id);
});

test('unique-context first-session nonce remains bound to the authenticated DirectAdmin operator, role, and impersonation state', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provisionUnique(registry);
  let authenticatedSession = apiSession('effective-user', 'operator-a', 'admin');
  const keys = await generateKeyPair('EdDSA');
  const trust = { issuer: ISSUER, audience: 'titan-login', key_id: 'test-da', algorithm: 'EdDSA', verification_key: keys.publicKey };
  const flow = security.createDirectAdminBootstrapFlow({ origin: ORIGIN, node_id: 'node-a', upstream: trust,
    signing_key: keys.privateKey, registry, now: () => new Date(NOW),
    fetcher: async () => response(authenticatedSession) });
  const issued = await flow.issueNonceForUniqueCurrentContext({ origin: ORIGIN, cookie: COOKIE, authorization: null });
  assert.deepEqual({ company_id: issued.company_id, device_id: issued.device_id },
    { company_id: 'company-a', device_id: 'device-a' });

  authenticatedSession = apiSession('effective-user', 'operator-b', 'admin');
  await assert.rejects(flow.provide({ origin: ORIGIN, cookie: COOKIE, authorization: null, csrf_nonce: issued.csrf_nonce }),
    { message: 'authentication-denied' });
  authenticatedSession = apiSession('effective-user', 'operator-a', 'reseller');
  await assert.rejects(flow.provide({ origin: ORIGIN, cookie: COOKIE, authorization: null, csrf_nonce: issued.csrf_nonce }),
    { message: 'authentication-denied' });
  authenticatedSession = apiSession('effective-user', 'effective-user', 'admin');
  await assert.rejects(flow.provide({ origin: ORIGIN, cookie: COOKIE, authorization: null, csrf_nonce: issued.csrf_nonce }),
    { message: 'authentication-denied' });

  authenticatedSession = apiSession('effective-user', 'operator-a', 'admin');
  const assertion = await flow.provide({ origin: ORIGIN, cookie: COOKIE, authorization: null, csrf_nonce: issued.csrf_nonce });
  assert.equal(assertion.company_id, issued.company_id);
  assert.equal(assertion.device_id, issued.device_id);
  const claims = JSON.parse(Buffer.from(assertion.login_assertion.split('.')[1], 'base64url').toString('utf8'));
  assert.deepEqual({ role: claims.da_role, real_subject: claims.real_sub, impersonating: claims.da_impersonating },
    { role: 'admin', real_subject: 'operator-a', impersonating: true });
});

test('first-session selection denies multiple companies instead of choosing a row', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provision(registry);
  await registry.putDevice({ device_id: 'device-b', actor_id: 'actor-a', status: 'revoked' }, 1);
  await assert.rejects(registry.issueDirectAdminBootstrapNonceForUniqueContext({
    origin: ORIGIN, subject: 'effective-user', real_subject: 'operator-admin', da_role: 'admin', impersonating: true,
  }), { message: 'identity-bootstrap-selection-ambiguous' });
  const issuer = security.createDirectAdminBootstrapNonceIssuer({ origin: ORIGIN, registry,
    fetcher: async () => response(apiSession()) });
  await assert.rejects(issuer.issueForUniqueCurrentContext({ origin: ORIGIN, cookie: COOKIE, authorization: null }),
    { message: 'authentication-denied' });
  assert.equal((await storage.query('SELECT COUNT(*) AS count FROM titan_security_directadmin_bootstrap_nonces')).rows[0].count, 0);
});

test('first-session selection denies multiple active devices instead of choosing a row', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provisionUnique(registry);
  await registry.putDevice({ device_id: 'device-b', actor_id: 'actor-a', status: 'active' }, null);
  await assert.rejects(registry.issueDirectAdminBootstrapNonceForUniqueContext({
    origin: ORIGIN, subject: 'effective-user', real_subject: 'operator-admin', da_role: 'admin', impersonating: true,
  }), { message: 'identity-bootstrap-selection-ambiguous' });
  assert.equal((await storage.query('SELECT COUNT(*) AS count FROM titan_security_directadmin_bootstrap_nonces')).rows[0].count, 0);
});

test('first-session selection denies an issuer subject mapped to distinct Titan actors', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provisionUnique(registry);
  await registry.putActor({ actor_id: 'actor-b', status: 'active' }, null);
  await registry.putCompany({ company_id: 'company-b', status: 'active' }, null);
  await registry.putMembership({ actor_id: 'actor-b', company_id: 'company-b', role: 'owner', status: 'active' }, null);
  await registry.putDevice({ device_id: 'device-b', actor_id: 'actor-b', status: 'active' }, null);
  await registry.putExternalBinding({ binding_id: 'binding-b', provider: ISSUER, subject: 'effective-user',
    actor_id: 'actor-b', company_id: 'company-b', status: 'active' }, null);
  await assert.rejects(registry.issueDirectAdminBootstrapNonceForUniqueContext({
    origin: ORIGIN, subject: 'effective-user', real_subject: 'operator-admin', da_role: 'admin', impersonating: true,
  }), { message: 'identity-binding-ambiguous' });
  assert.equal((await storage.query('SELECT COUNT(*) AS count FROM titan_security_directadmin_bootstrap_nonces')).rows[0].count, 0);
});

test('first-session selection denies a revoked membership with no eligible canonical context', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provisionUnique(registry);
  await registry.putMembership({ actor_id: 'actor-a', company_id: 'company-a', role: 'owner', status: 'revoked' }, 1);

  await assert.rejects(registry.issueDirectAdminBootstrapNonceForUniqueContext({
    origin: ORIGIN, subject: 'effective-user', real_subject: 'operator-admin', da_role: 'admin', impersonating: true,
  }), { message: 'identity-bootstrap-selection-unavailable' });
  assert.equal((await storage.query('SELECT COUNT(*) AS count FROM titan_security_directadmin_bootstrap_nonces')).rows[0].count, 0);
});

test('unique first-session nonce becomes unusable after membership revocation and registry restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'titan-da-unique-context-restart-'));
  const path = join(directory, 'identity.sqlite');
  let storage = createSqliteStorage(path);
  let registry = await security.createIdentitySessionRegistry({ storage, storage_role: 'GLOBAL_REGISTRY', now: () => new Date(NOW) });
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }); });
  await enableNonceStore(storage);
  await provisionUnique(registry);
  const keys = await generateKeyPair('EdDSA');
  const trust = { issuer: ISSUER, audience: 'titan-login', key_id: 'test-da', algorithm: 'EdDSA', verification_key: keys.publicKey };
  const flow = security.createDirectAdminBootstrapFlow({ origin: ORIGIN, node_id: 'node-a', upstream: trust,
    signing_key: keys.privateKey, registry, now: () => new Date(NOW),
    fetcher: async () => response(apiSession()) });
  const issued = await flow.issueNonceForUniqueCurrentContext({ origin: ORIGIN, cookie: COOKIE, authorization: null });
  assert.deepEqual({ company_id: issued.company_id, device_id: issued.device_id },
    { company_id: 'company-a', device_id: 'device-a' });

  await storage.close();
  storage = createSqliteStorage(path);
  registry = await security.createIdentitySessionRegistry({ storage, storage_role: 'GLOBAL_REGISTRY', now: () => new Date(NOW) });
  const persisted = (await storage.query('SELECT company_id,device_id FROM titan_security_directadmin_bootstrap_nonces')).rows[0];
  assert.deepEqual(persisted, { company_id: 'company-a', device_id: 'device-a' });
  await registry.putMembership({ actor_id: 'actor-a', company_id: 'company-a', role: 'owner', status: 'revoked' }, 1);
  const restartedFlow = security.createDirectAdminBootstrapFlow({ origin: ORIGIN, node_id: 'node-a', upstream: trust,
    signing_key: keys.privateKey, registry, now: () => new Date(NOW),
    fetcher: async () => response(apiSession()) });
  await assert.rejects(restartedFlow.provide({ origin: ORIGIN, cookie: COOKIE, authorization: null,
    csrf_nonce: issued.csrf_nonce }), { message: 'authentication-denied' });
  const consumed = (await storage.query('SELECT consumed_at FROM titan_security_directadmin_bootstrap_nonces')).rows[0];
  assert.notEqual(consumed.consumed_at, null);
});

test('rejects invalid DirectAdmin hosts, unmapped company/device, and overlong nonce lifetimes', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provision(registry);
  for (const origin of ['http://da.example.test', 'https://da.example.test/path', 'https://user@da.example.test']) {
    await assert.rejects(registry.issueDirectAdminBootstrapNonce(registryIssue({ origin })));
  }
  await assert.rejects(registry.issueDirectAdminBootstrapNonce(registryIssue({ company_id: 'unmapped-company' })));
  await assert.rejects(registry.issueDirectAdminBootstrapNonce(registryIssue({ device_id: 'unmapped-device' })));
  await assert.rejects(registry.issueDirectAdminBootstrapNonce(registryIssue({ lifetime_seconds: 301 })));
  assert.equal((await storage.query('SELECT COUNT(*) AS count FROM titan_security_directadmin_bootstrap_nonces')).rows[0].count, 0);
});

test('wrong subject, host issuer, or origin cannot consume another host’s nonce', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provision(registry);
  const issued = await registry.issueDirectAdminBootstrapNonce(registryIssue());

  assert.equal(await registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce, { subject: 'other-user' })), null);
  assert.equal(await registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce, { issuer: 'directadmin:https://other.example.test:2222' })), null);
  assert.equal(await registry.consumeDirectAdminBootstrapNonce({ ...consumeProof(issued.csrf_nonce),
    origin: 'https://other.example.test:2222', issuer: 'directadmin:https://other.example.test:2222' }), null);
  assert.deepEqual(await registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce)),
    { company_id: 'company-a', device_id: 'device-a' });
  assert.equal(await registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce)), null);
});

test('a nonce cannot move between DirectAdmin operators acting as the same effective user', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provision(registry);
  let authenticatedSession = apiSession('effective-user', 'operator-a', 'admin');
  const keys = await generateKeyPair('EdDSA');
  const trust = { issuer: ISSUER, audience: 'titan-login', key_id: 'test-da', algorithm: 'EdDSA', verification_key: keys.publicKey };
  const flow = security.createDirectAdminBootstrapFlow({ origin: ORIGIN, node_id: 'node-a', upstream: trust,
    signing_key: keys.privateKey, registry, now: () => new Date(NOW),
    fetcher: async () => response(authenticatedSession) });
  const issued = await flow.issueNonce(issueProof());

  authenticatedSession = apiSession('effective-user', 'operator-b', 'admin');
  await assert.rejects(flow.provide({ origin: ORIGIN, cookie: COOKIE, authorization: null, csrf_nonce: issued.csrf_nonce }),
    { message: 'authentication-denied' });

  authenticatedSession = apiSession('effective-user', 'operator-a', 'admin');
  const assertion = await flow.provide({ origin: ORIGIN, cookie: COOKIE, authorization: null, csrf_nonce: issued.csrf_nonce });
  assert.equal(assertion.company_id, 'company-a');
  assert.equal(assertion.device_id, 'device-a');
});

test('a nonce remains bound to the authenticated DirectAdmin role and impersonation state', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provision(registry);
  const issued = await registry.issueDirectAdminBootstrapNonce(registryIssue({
    real_subject: 'operator-a', da_role: 'admin', impersonating: true,
  }));

  assert.equal(await registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce, {
    real_subject: 'operator-a', da_role: 'reseller', impersonating: true,
  })), null);
  assert.equal(await registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce, {
    real_subject: 'effective-user', da_role: 'admin', impersonating: false,
  })), null);
  assert.deepEqual(await registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce, {
    real_subject: 'operator-a', da_role: 'admin', impersonating: true,
  })), { company_id: 'company-a', device_id: 'device-a' });
});

test('expired nonce is denied and nonce lifetime cannot be extended by the consumer', async t => {
  let at = new Date(NOW);
  const { storage, registry } = await store(':memory:', () => new Date(at));
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provision(registry);
  const issued = await registry.issueDirectAdminBootstrapNonce(registryIssue({ lifetime_seconds: 10 }));
  at = new Date(Date.parse(issued.expires_at));
  assert.equal(await registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce)), null);
  assert.equal((await storage.query('SELECT consumed_at FROM titan_security_directadmin_bootstrap_nonces')).rows[0].consumed_at, null);
});

test('a failed current-identity exchange burns the authenticated nonce', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provision(registry);
  const issued = await registry.issueDirectAdminBootstrapNonce(registryIssue());
  await registry.putMembership({ actor_id: 'actor-a', company_id: 'company-a', role: 'owner', status: 'revoked' }, 1);
  assert.equal(await registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce)), null);
  assert.ok((await storage.query('SELECT consumed_at FROM titan_security_directadmin_bootstrap_nonces')).rows[0].consumed_at);
  await registry.putMembership({ actor_id: 'actor-a', company_id: 'company-a', role: 'owner', status: 'active' }, 2);
  assert.equal(await registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce)), null);
});

test('a still-active but revision-stale selection cannot consume the nonce', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provision(registry);
  const issued = await registry.issueDirectAdminBootstrapNonce(registryIssue());
  await registry.putMembership({ actor_id: 'actor-a', company_id: 'company-a', role: 'tech', status: 'active' }, 1);
  assert.equal(await registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce)), null);
  assert.ok((await storage.query('SELECT consumed_at FROM titan_security_directadmin_bootstrap_nonces')).rows[0].consumed_at);
});

for (const [name, revoke] of [
  ['actor', registry => registry.putActor({ actor_id: 'actor-a', status: 'revoked' }, 1)],
  ['company', registry => registry.putCompany({ company_id: 'company-a', status: 'revoked' }, 1)],
  ['device', registry => registry.putDevice({ device_id: 'device-a', actor_id: 'actor-a', status: 'revoked' }, 1)],
  ['external binding', registry => registry.putExternalBinding({ binding_id: 'binding-a', provider: ISSUER,
    subject: 'effective-user', actor_id: 'actor-a', company_id: 'company-a', status: 'revoked' }, 1)],
]) {
  test(`a nonce is burned after current ${name} revocation and cannot revive`, async t => {
    const { storage, registry } = await store();
    t.after(() => storage.close());
    await enableNonceStore(storage);
    await provision(registry);
    const issued = await registry.issueDirectAdminBootstrapNonce(registryIssue());
    await revoke(registry);
    assert.equal(await registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce)), null);
    assert.ok((await storage.query('SELECT consumed_at FROM titan_security_directadmin_bootstrap_nonces')).rows[0].consumed_at);
    assert.equal(await registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce)), null);
  });
}

test('two independent SQLite connections cannot consume the same nonce concurrently', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'titan-da-nonce-race-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'identity.sqlite');
  const first = await store(path);
  t.after(() => first.storage.close());
  await enableNonceStore(first.storage);
  await provision(first.registry);
  const issued = await first.registry.issueDirectAdminBootstrapNonce(registryIssue());
  const secondStorage = createSqliteStorage(path);
  t.after(() => secondStorage.close());
  const second = new security.IdentitySessionRegistry(secondStorage, () => new Date(NOW));

  const results = await Promise.allSettled([
    first.registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce)),
    second.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce)),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled' && result.value !== null).length, 1);
  assert.equal(results.filter(result => result.status === 'fulfilled' && result.value === null).length
    + results.filter(result => result.status === 'rejected' && result.reason?.message === 'identity-registry-unavailable').length, 1);
  assert.equal(await first.registry.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce)), null);
  assert.equal(await second.consumeDirectAdminBootstrapNonce(consumeProof(issued.csrf_nonce)), null);
});

test('authenticated issuer and durable consumer survive restart; no subject or actor input is accepted', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'titan-da-nonce-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'identity.sqlite');
  let storage = createSqliteStorage(path);
  let registry = await security.createIdentitySessionRegistry({ storage, storage_role: 'GLOBAL_REGISTRY', now: () => new Date(NOW) });
  await security.initializeDirectAdminBootstrapNonceStore({ storage, storage_role: 'GLOBAL_REGISTRY' });
  await provision(registry);
  const keys = await generateKeyPair('EdDSA');
  const trust = { issuer: ISSUER, audience: 'titan-login', key_id: 'test-da', algorithm: 'EdDSA', verification_key: keys.publicKey };
  let fetchCalls = 0;
  const fetcher = async (url, init) => {
    fetchCalls++;
    assert.equal(String(url), `${ORIGIN}/api/session`);
    assert.equal(init.headers.cookie, COOKIE);
    assert.equal(init.headers.authorization, undefined);
    return response(apiSession());
  };
  const flow = security.createDirectAdminBootstrapFlow({ origin: ORIGIN, node_id: 'node-a', upstream: trust,
    signing_key: keys.privateKey, registry, now: () => new Date(NOW), fetcher });

  await assert.rejects(flow.issueNonce({ ...issueProof(), subject: 'caller-forged-subject' }), { message: 'authentication-denied' });
  const issued = await flow.issueNonce(issueProof());
  const assertion = await flow.provide({ origin: ORIGIN, cookie: COOKIE, authorization: null, csrf_nonce: issued.csrf_nonce });
  assert.equal(assertion.company_id, 'company-a');
  assert.equal(assertion.device_id, 'device-a');
  assert.equal(fetchCalls, 2);

  await storage.close();
  storage = createSqliteStorage(path);
  registry = await security.createIdentitySessionRegistry({ storage, storage_role: 'GLOBAL_REGISTRY', now: () => new Date(NOW) });
  const restartedFlow = security.createDirectAdminBootstrapFlow({ origin: ORIGIN, node_id: 'node-a', upstream: trust,
    signing_key: keys.privateKey, registry, now: () => new Date(NOW), fetcher });
  await assert.rejects(restartedFlow.provide({ origin: ORIGIN, cookie: COOKIE, authorization: null,
    csrf_nonce: issued.csrf_nonce }), { message: 'authentication-denied' });
  const rows = (await storage.query('SELECT consumed_at,nonce_hash FROM titan_security_directadmin_bootstrap_nonces')).rows;
  assert.equal(rows.length, 1);
  assert.ok(rows[0].consumed_at);
  assert.equal(rows[0].nonce_hash, createHash('sha256').update(issued.csrf_nonce).digest('hex'));
  assert.equal(JSON.stringify(rows).includes(issued.csrf_nonce), false);
  await storage.close();
});

test('issuer does not mint for unauthenticated DirectAdmin proof or unregistered canonical mapping', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provision(registry);
  let session = apiSession();
  let fetchCalls = 0;
  const issuer = security.createDirectAdminBootstrapNonceIssuer({ origin: ORIGIN, registry,
    fetcher: async () => { fetchCalls++; return response(session, session === null ? 401 : 200); } });
  await assert.rejects(issuer.issue(issueProof({ origin: 'https://attacker.example.test' })), { message: 'authentication-denied' });
  await assert.rejects(issuer.issue(issueProof({ authorization: 'Basic caller-value' })), { message: 'authentication-denied' });
  assert.equal(fetchCalls, 0);
  session = null;
  await assert.rejects(issuer.issue(issueProof()), { message: 'authentication-denied' });
  assert.equal((await storage.query('SELECT COUNT(*) AS count FROM titan_security_directadmin_bootstrap_nonces')).rows[0].count, 0);
  session = apiSession('unmapped-user');
  await assert.rejects(issuer.issue(issueProof()), { message: 'authentication-denied' });
  assert.equal((await storage.query('SELECT COUNT(*) AS count FROM titan_security_directadmin_bootstrap_nonces')).rows[0].count, 0);
});

test('nonce issuer rejects unallowlisted cookies and canonicalizes the exact session/key pair', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  await enableNonceStore(storage);
  await provision(registry);
  let fetchedCookie;
  const issuer = security.createDirectAdminBootstrapNonceIssuer({ origin: ORIGIN, registry,
    fetcher: async (_url, init) => { fetchedCookie = init.headers.cookie; return response(apiSession()); } });
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
    await assert.rejects(issuer.issue(issueProof({ cookie })), { message: 'authentication-denied' });
  }
  assert.equal(fetchedCookie, undefined);

  await issuer.issue(issueProof({ cookie: ' key=test-only=key ; session=test-only-session ' }));
  assert.equal(fetchedCookie, 'session=test-only-session; key=test-only=key');
});

test('an uninitialized nonce add-on is service-unavailable, not a credential denial', async t => {
  const { storage, registry } = await store();
  t.after(() => storage.close());
  const issuer = security.createDirectAdminBootstrapNonceIssuer({ origin: ORIGIN, registry,
    fetcher: async () => response(apiSession()) });
  await assert.rejects(issuer.issue(issueProof()), { message: 'directadmin-service-unavailable' });
});
