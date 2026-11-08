import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeJwt, decodeProtectedHeader, generateKeyPair, SignJWT } from 'jose';
import { tsImport } from 'tsx/esm/api';
import {
  createIdentitySessionRegistry, createSessionCredentialService,
  createSessionCredentialVerifier, directAdminIssuer,
} from '../.test-dist/security-boundary.js';

const { createSqliteStorage } = await tsImport('@titan-zero/storage', { parentURL: import.meta.url, tsconfig: false });
const epoch = Date.parse('2026-10-02T00:00:00Z');
const origin = 'https://da-one.example.test:2222';
const provider = directAdminIssuer(origin);
const sourceExpectation = { company_id: 'company-a', device_id: 'device-1' };
const denied = promise => assert.rejects(promise, { message: 'authentication-denied' });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'titan-workforce-exchange-'));
  const path = join(directory, 'global-registry.sqlite');
  const daSessionKeys = await generateKeyPair('EdDSA');
  const daLoginKeys = await generateKeyPair('EdDSA');
  const workforceKeys = await generateKeyPair('EdDSA');
  let at = epoch;
  let storage = createSqliteStorage(path);
  let registry = await createIdentitySessionRegistry({ storage, storage_role: 'GLOBAL_REGISTRY', now: () => new Date(at) });

  const options = () => ({
    registry,
    upstream: { issuer: provider, audience: 'da-login', key_id: 'da-login-key', algorithm: 'EdDSA', verification_key: daLoginKeys.publicKey },
    directadmin: { node_id: 'node-one' },
    now: () => new Date(at),
  });
  const sourceService = () => createSessionCredentialService({
    ...options(), issuer: 'titan:directadmin-auth', audience: 'directadmin-browser', key_id: 'da-session-key', algorithm: 'EdDSA',
    signing_key: daSessionKeys.privateKey, verification_key: daSessionKeys.publicKey,
    workforce_zero_exchange: {
      issuer: 'titan:workforce-auth', key_id: 'workforce-session-key', algorithm: 'EdDSA',
      signing_key: workforceKeys.privateKey, verification_key: workforceKeys.publicKey, lifetime_seconds: 120,
    },
  });
  const workforceVerifier = () => createSessionCredentialVerifier({
    ...options(), issuer: 'titan:workforce-auth', audience: 'workforce', key_id: 'workforce-session-key', algorithm: 'EdDSA',
    verification_key: workforceKeys.publicKey, lifetime_seconds: 300,
  });
  let source = sourceService();
  let verifier = workforceVerifier();

  await registry.putActor({ actor_id: 'actor-1', status: 'active' }, null);
  await registry.putDevice({ actor_id: 'actor-1', device_id: 'device-1', status: 'active' }, null);
  for (const company_id of ['company-a', 'company-b']) {
    await registry.putCompany({ company_id, status: 'active' }, null);
    await registry.putMembership({ actor_id: 'actor-1', company_id, role: 'owner', status: 'active' }, null);
    await registry.putExternalBinding({ provider, subject: 'da-user-1', actor_id: 'actor-1', company_id,
      binding_id: `binding-${company_id}`, status: 'active' }, null);
  }

  const csrf = Buffer.from(await crypto.subtle.digest('SHA-256', crypto.getRandomValues(new Uint8Array(32)))).toString('base64url');
  async function login({ jti = 'da-login-once', company_id = 'company-a', device_id = 'device-1', exp = epoch / 1000 + 60,
    identity_provider = provider, node_id = 'node-one', csrf_sha256 = csrf, da_role = 'admin' } = {}) {
    return new SignJWT({ jti, company_id, device_id, identity_provider, node_id, csrf_sha256, da_role })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'da-login-key', typ: 'titan-login+jwt' })
      .setIssuer(identity_provider).setAudience('da-login').setSubject('da-user-1')
      .setIssuedAt(Math.floor(at / 1000)).setExpirationTime(exp).sign(daLoginKeys.privateKey);
  }
  async function issueSource(values = {}) {
    return source.issue(await login(values), { company_id: values.company_id ?? 'company-a', device_id: values.device_id ?? 'device-1' });
  }
  async function exchange(values = {}) {
    const da = await issueSource(values);
    const workforce = await source.exchangeWorkforceZero(da.credential, {
      company_id: values.company_id ?? 'company-a', device_id: values.device_id ?? 'device-1',
    });
    return { da, workforce };
  }
  async function signSource(token, changes = {}, headerChanges = {}, key = daSessionKeys.privateKey) {
    const payload = { ...decodeJwt(token), ...changes };
    const header = { ...decodeProtectedHeader(token), ...headerChanges };
    return new SignJWT(payload).setProtectedHeader(header).sign(key);
  }
  async function signTarget(token, changes = {}, headerChanges = {}) {
    const claims = { ...decodeJwt(token), ...changes };
    const header = { ...decodeProtectedHeader(token), ...headerChanges };
    return new SignJWT(claims).setProtectedHeader(header).sign(workforceKeys.privateKey);
  }

  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }); });
  return {
    path, provider, daSessionKeys, daLoginKeys, workforceKeys, login, issueSource, exchange, signSource, signTarget,
    get storage() { return storage; }, get registry() { return registry; }, get source() { return source; },
    get verifier() { return verifier; }, get at() { return at; },
    setTime(value) { at = value; },
    async restart() {
      await storage.close();
      storage = createSqliteStorage(path);
      registry = await createIdentitySessionRegistry({ storage, storage_role: 'GLOBAL_REGISTRY', now: () => new Date(at) });
      source = sourceService();
      verifier = workforceVerifier();
    },
  };
}

function proofFor(authenticated, credential) {
  return {
    provider: authenticated.provider, subject: authenticated.subject,
    session_id: authenticated.context.session_id, device_id: authenticated.context.device_id,
    session_revision: authenticated.context.session_revision,
    credential_expires_at: new Date(decodeJwt(credential).exp * 1000).toISOString(),
    source_session: authenticated.source_session,
  };
}

function expectedFor(authenticated) {
  return { audience: 'workforce', company_id: authenticated.context.company_id,
    actor_id: authenticated.context.actor_id, context_revision: authenticated.context.context_revision };
}

test('DA session exchange derives one fixed Workforce/Zero child with source-capped expiry and no bearer persistence', async t => {
  const f = await fixture(t);
  const { da, workforce } = await f.exchange();
  const claims = decodeJwt(workforce.credential);
  const source = await f.verifier.authenticate(workforce.credential);

  assert.equal(claims.aud, 'workforce');
  assert.equal(claims.surface, 'zero');
  assert.equal(claims.identity_provider, f.provider);
  assert.equal(claims.source_session.session_id, da.context.session_id);
  assert.equal(claims.source_session.session_revision, da.context.session_revision);
  assert.equal(claims.source_session.context_revision, da.context.context_revision);
  assert.equal(claims.source_session.company_id, da.context.company_id);
  assert.equal(claims.source_session.device_id, da.context.device_id);
  assert.equal(claims.source_session.actor_id, da.context.actor_id);
  assert.equal(claims.source_session.node_id, 'node-one');
  assert.equal(claims.exp, decodeJwt(da.credential).exp);
  assert.equal(source.surface, 'zero');
  assert.equal(source.context.audience, 'workforce');
  assert.deepEqual(source.context.allowed_company_ids, ['company-a']);
  assert.equal('directadmin' in source, false);

  await denied(f.source.exchangeWorkforceZero(da.credential, {
    ...sourceExpectation, audience: 'hub', surface: 'hub',
  }));
  const retry = await f.source.exchangeWorkforceZero(da.credential, sourceExpectation);
  assert.equal(retry.context.session_id, workforce.context.session_id);
  assert.equal(retry.context.expires_at, workforce.context.expires_at);
  assert.equal((await f.storage.query('SELECT COUNT(*) AS count FROM titan_security_sessions')).rows[0].count, 2);
  const tables = (await f.storage.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).rows.map(row => row.name);
  assert.deepEqual(tables, ['titan_security_actors','titan_security_companies','titan_security_devices',
    'titan_security_external_bindings','titan_security_memberships','titan_security_migrations','titan_security_sessions']);
  const rows = await f.storage.query('SELECT * FROM titan_security_sessions');
  assert.equal(JSON.stringify(rows).includes(da.credential), false);
  assert.equal(JSON.stringify(rows).includes(workforce.credential), false);
});

test('a signing service cannot mint an independent Workforce session from a DirectAdmin issuer', async t => {
  const f = await fixture(t);
  assert.throws(() => createSessionCredentialService({
    registry: f.registry,
    issuer: 'titan:workforce-auth', audience: 'workforce', key_id: 'workforce-session-key', algorithm: 'EdDSA',
    signing_key: f.workforceKeys.privateKey, verification_key: f.workforceKeys.publicKey,
    upstream: { issuer: f.provider, audience: 'da-login', key_id: 'da-login-key', algorithm: 'EdDSA',
      verification_key: f.daLoginKeys.publicKey },
    directadmin: { node_id: 'node-one' }, now: () => new Date(f.at),
  }), { message: 'workforce-zero-exchange-required' });
  // The target host's public-key-only verifier remains a supported consumer.
  assert.equal(typeof f.verifier.authenticate, 'function');
});

test('idempotent child expiry can only tighten and tightening advances its revision', async t => {
  const f = await fixture(t);
  const da = await f.issueSource();
  const first = await f.source.exchangeWorkforceZero(da.credential, sourceExpectation);
  const shorterSource = await f.signSource(da.credential, { exp: epoch / 1000 + 30 });
  const tightened = await f.source.exchangeWorkforceZero(shorterSource, sourceExpectation);
  assert.equal(tightened.context.session_id, first.context.session_id);
  assert.equal(tightened.context.session_revision, first.context.session_revision + 1);
  assert.equal(Date.parse(tightened.credential_expires_at), epoch + 30_000);
  await denied(f.verifier.authenticate(first.credential));
  assert.equal((await f.verifier.authenticate(tightened.credential)).context.session_revision,
    tightened.context.session_revision);
  const retry = await f.source.exchangeWorkforceZero(shorterSource, sourceExpectation);
  assert.equal(retry.context.session_id, first.context.session_id);
  assert.equal(retry.context.session_revision, tightened.context.session_revision);
});

test('exchange rejects login assertions, wrong DA host/audience/node/algorithm/key/type, tampering and context substitution', async t => {
  const f = await fixture(t);
  const da = await f.issueSource();
  const loginAssertion = await f.login({ jti: 'another-login' });
  await denied(f.source.exchangeWorkforceZero(loginAssertion, sourceExpectation));

  const wrongAlgorithmKey = crypto.getRandomValues(new Uint8Array(32));
  const variants = [
    ['host identity', await f.signSource(da.credential, { identity_provider: directAdminIssuer('https://da-two.example.test') })],
    ['source JWT issuer', await f.signSource(da.credential, { iss: 'titan:other-host' })],
    ['source audience', await f.signSource(da.credential, { aud: 'workforce' })],
    ['node', await f.signSource(da.credential, { node_id: 'node-two' })],
    ['subject', await f.signSource(da.credential, { sub: 'someone-else' })],
    ['company', await f.signSource(da.credential, { company_id: 'company-b' })],
    ['device', await f.signSource(da.credential, { device_id: 'device-two' })],
    ['key identifier', await f.signSource(da.credential, {}, { kid: 'untrusted-key' })],
    ['type', await f.signSource(da.credential, {}, { typ: 'JWT' })],
    ['algorithm', await f.signSource(da.credential, {}, { alg: 'HS256', kid: 'da-session-key' }, wrongAlgorithmKey)],
  ];
  const parts = da.credential.split('.');
  const signature = Buffer.from(parts[2], 'base64url');
  signature[0] ^= 1;
  parts[2] = signature.toString('base64url');
  variants.push(['signature', parts.join('.')]);
  for (const [label, token] of variants) await assert.rejects(f.source.exchangeWorkforceZero(token, sourceExpectation), { message: 'authentication-denied' }, label);

  const { workforce } = await f.exchange({ jti: 'second-login' });
  await denied(f.verifier.authenticate(await f.signTarget(workforce.credential, { aud: 'directadmin' })));
  await denied(f.verifier.authenticate(await f.signTarget(workforce.credential, { surface: 'hub' })));
  const changedParent = structuredClone(decodeJwt(workforce.credential).source_session);
  changedParent.session_id = 'different-source-session';
  await denied(f.verifier.authenticate(await f.signTarget(workforce.credential, { source_session: changedParent })));
  await denied(f.verifier.authenticate(await f.signTarget(workforce.credential, { actor_id: 'actor-other' })));
  await denied(f.verifier.authenticate(await f.signTarget(workforce.credential, { company_id: 'company-b' })));
  await denied(f.verifier.authenticate(await f.signTarget(workforce.credential, { device_id: 'device-other' })));
});

for (const kind of ['switch','revoke','company','device','membership','actor','binding','expiry']) {
  test(`derived Workforce credential rejects current source ${kind} change across registry restart`, async t => {
    const f = await fixture(t);
    const { da, workforce } = await f.exchange();
    switch (kind) {
      case 'switch': await f.source.switchCompany(da.credential, sourceExpectation, 'company-b'); break;
      case 'revoke': await f.source.revoke(da.credential, sourceExpectation); break;
      case 'company': await f.registry.putCompany({ company_id: 'company-a', status: 'suspended' }, 1); break;
      case 'device': await f.registry.putDevice({ actor_id: 'actor-1', device_id: 'device-1', status: 'revoked' }, 1); break;
      case 'membership': await f.registry.putMembership({ actor_id: 'actor-1', company_id: 'company-a', role: 'owner', status: 'revoked' }, 1); break;
      case 'actor': await f.registry.putActor({ actor_id: 'actor-1', status: 'suspended' }, 1); break;
      case 'binding': await f.registry.putExternalBinding({ provider: f.provider, subject: 'da-user-1', actor_id: 'actor-1',
        company_id: 'company-a', binding_id: 'binding-company-a', status: 'revoked' }, 1); break;
      case 'expiry': f.setTime(epoch + 60_000); break;
    }
    await f.restart();
    await denied(f.verifier.authenticate(workforce.credential));
    await denied(f.verifier.resolve(workforce.credential, sourceExpectation));
  });
}

test('derived child cannot switch independently and a revoked idempotent child is never recreated', async t => {
  const f = await fixture(t);
  const { da, workforce } = await f.exchange();
  const targetService = createSessionCredentialService({
    registry: f.registry, issuer: 'titan:workforce-auth', audience: 'workforce', key_id: 'workforce-session-key', algorithm: 'EdDSA',
    signing_key: undefined, verification_key: f.workforceKeys.publicKey,
    upstream: { issuer: f.provider, audience: 'da-login', key_id: 'da-login-key', algorithm: 'EdDSA', verification_key: f.daLoginKeys.publicKey },
    directadmin: { node_id: 'node-one' }, now: () => new Date(f.at),
  });
  await denied(targetService.switchCompany(workforce.credential, sourceExpectation, 'company-b'));
  const authenticated = await targetService.authenticate(workforce.credential);
  await targetService.revoke(workforce.credential, sourceExpectation);
  await f.restart();
  await denied(f.verifier.authenticate(workforce.credential));
  await denied(f.source.exchangeWorkforceZero(da.credential, sourceExpectation));
  assert.equal((await f.storage.query('SELECT COUNT(*) AS count FROM titan_security_sessions')).rows[0].count, 2);
});

function startChildRevocation(path) {
  const child = fork(new URL('./fixtures/security-session-fence-revoke-child.mjs', import.meta.url),
    [path], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let done = false;
  let error;
  let readyResolve;
  let attemptingResolve;
  let readyReject;
  let attemptingReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const attempting = new Promise((resolve, reject) => { attemptingResolve = resolve; attemptingReject = reject; });
  const exited = once(child, 'exit');
  child.on('message', message => {
    if (message?.type === 'ready') readyResolve();
    if (message?.type === 'attempting') attemptingResolve();
    if (message?.type === 'done') done = true;
    if (message?.type === 'error') { error = message.message; attemptingReject(new Error(error)); }
  });
  child.once('error', error => { readyReject(error); attemptingReject(error); });
  return { child, ready, attempting, start(sessionId, revision) {
    child.send({ type: 'revoke', session_id: sessionId, revision });
  }, get done() { return done; }, get error() { return error; }, exited };
}

test('effect fence rejects when source revoke commits first', async t => {
  const f = await fixture(t);
  const { da, workforce } = await f.exchange();
  const authenticated = await f.verifier.authenticate(workforce.credential);
  const proof = proofFor(authenticated, workforce.credential);
  let mutations = 0;
  const child = startChildRevocation(f.path);
  await child.ready;
  child.start(da.context.session_id, da.context.session_revision);
  await child.attempting;
  const [exitCode] = await child.exited;
  assert.equal(exitCode, 0, child.error);
  assert.equal(child.done, true);
  await assert.rejects(f.registry.withCurrentSessionFence(proof, expectedFor(authenticated), {}, () => {
    mutations += 1;
  }));
  assert.equal(mutations, 0);
});

test('effect fence uses the registry clock after authentication and denies an expired child', async t => {
  const f = await fixture(t);
  const { workforce } = await f.exchange();
  const authenticated = await f.verifier.authenticate(workforce.credential);
  const proof = proofFor(authenticated, workforce.credential);
  f.setTime(epoch + 60_000);
  let mutations = 0;
  await assert.rejects(f.registry.withCurrentSessionFence(proof, expectedFor(authenticated), {}, () => {
    mutations += 1;
  }));
  assert.equal(mutations, 0);
});

test('effect fence passes the same absolute acquisition deadline to storage and its callback', async t => {
  const f = await fixture(t);
  const { workforce } = await f.exchange();
  const authenticated = await f.verifier.authenticate(workforce.credential);
  const proof = proofFor(authenticated, workforce.credential);
  const transaction = f.storage.transaction.bind(f.storage);
  let storageDeadline;
  f.storage.transaction = (callback, options) => {
    storageDeadline = options?.acquireDeadlineMs;
    return transaction(callback, options);
  };
  let effectDeadline;
  const result = await f.registry.withCurrentSessionFence(proof, expectedFor(authenticated), {}, (_current, _signal, deadline) => {
    effectDeadline = deadline;
    assert.equal(storageDeadline, deadline);
    assert.ok(Number.isFinite(deadline));
    assert.ok(deadline > performance.now());
    return 'admitted';
  });
  assert.equal(result, 'admitted');
  assert.equal(effectDeadline, storageDeadline);
});

test('effect fence linearizes before cross-process source revoke and releases after the bounded callback', async t => {
  const f = await fixture(t);
  const { da, workforce } = await f.exchange();
  const authenticated = await f.verifier.authenticate(workforce.credential);
  const proof = proofFor(authenticated, workforce.credential);
  const entered = deferred();
  const release = deferred();
  const child = startChildRevocation(f.path);
  await child.ready;
  let mutations = 0;
  const fenced = f.registry.withCurrentSessionFence(proof, expectedFor(authenticated), {}, async () => {
    entered.resolve();
    await release.promise;
    mutations += 1;
    return 'admitted';
  });
  await entered.promise;
  child.start(da.context.session_id, da.context.session_revision);
  await child.attempting;
  await wait(20);
  assert.equal(child.done, false);
  release.resolve();
  assert.equal(await fenced, 'admitted');
  const [exitCode] = await child.exited;
  assert.equal(exitCode, 0, child.error);
  assert.equal(mutations, 1);
  await denied(f.verifier.authenticate(workforce.credential));
});

test('timed-out noncooperative effect is not claimed cancelled and may finish after source revoke', async t => {
  const f = await fixture(t);
  const { da, workforce } = await f.exchange();
  const authenticated = await f.verifier.authenticate(workforce.credential);
  const proof = proofFor(authenticated, workforce.credential);
  const entered = deferred();
  const release = deferred();
  const lateFinish = deferred();
  const child = startChildRevocation(f.path);
  await child.ready;
  let mutations = 0;
  let observedAbort = false;
  const fenced = f.registry.withCurrentSessionFence(proof, expectedFor(authenticated), {}, async (_current, signal) => {
    signal.addEventListener('abort', () => { observedAbort = true; }, { once: true });
    entered.resolve();
    // Simulate an adapter that ignores AbortSignal and finishes after timeout.
    await release.promise;
    mutations += 1;
    lateFinish.resolve();
  });
  await entered.promise;
  child.start(da.context.session_id, da.context.session_revision);
  await child.attempting;
  await assert.rejects(fenced, { message: 'session-fence-timeout' });
  assert.equal(observedAbort, true);
  const [exitCode] = await child.exited;
  assert.equal(exitCode, 0, child.error);
  assert.equal(mutations, 0);
  release.resolve();
  await lateFinish.promise;
  assert.equal(mutations, 1);
  await denied(f.verifier.authenticate(workforce.credential));
});
