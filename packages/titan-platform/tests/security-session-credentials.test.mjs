import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT, decodeJwt, generateKeyPair } from 'jose';
import { tsImport } from 'tsx/esm/api';
import { createIdentitySessionRegistry, createSessionCredentialService, directAdminIssuer } from '../.test-dist/security-boundary.js';
const { createSqliteStorage } = await tsImport('@titan-zero/storage', { parentURL: import.meta.url, tsconfig: false });
const epoch = Date.parse('2026-10-02T00:00:00Z');
const issuer = 'https://idp-one.example.test';
const expectation = { company_id: 'company-a', device_id: 'device-1' };

async function fixture(t, config = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'titan-credential-'));
  const path = join(directory, 'identity.sqlite');
  let storage = createSqliteStorage(path);
  let registry = await createIdentitySessionRegistry({ storage, storage_role: 'GLOBAL_REGISTRY' });
  t.after(async () => { await storage.close(); await rm(directory, { recursive: true, force: true }); });
  const keys = await generateKeyPair('EdDSA');
  const loginKeys = await generateKeyPair('EdDSA');
  const wrongKeys = await generateKeyPair('EdDSA');
  let at = epoch;
  const policy = { issuer: 'titan:node-one', audience: 'workforce', key_id: 'test-access', algorithm: 'EdDSA',
    signing_key: keys.privateKey, verification_key: keys.publicKey,
    upstream: { issuer, audience: 'titan-login', key_id: 'test-login', algorithm: 'EdDSA', verification_key: loginKeys.publicKey },
    now: () => new Date(at), ...config };
  let service = createSessionCredentialService({ ...policy, registry });
  await registry.putActor({ actor_id: 'actor-1', status: 'active' }, null);
  await registry.putDevice({ actor_id: 'actor-1', device_id: 'device-1', status: 'active' }, null);
  for (const company_id of ['company-a', 'company-b']) {
    await registry.putCompany({ company_id, status: 'active' }, null);
    await registry.putMembership({ actor_id: 'actor-1', company_id, role: company_id === 'company-a' ? 'owner' : 'tech', status: 'active' }, null);
    await registry.putExternalBinding({ provider: issuer, subject: 'external-user', actor_id: 'actor-1', company_id, binding_id: `binding-${company_id}`, status: 'active' }, null);
  }
  async function sign(payload, key, header) { return new SignJWT(payload).setProtectedHeader(header).sign(key); }
  async function login(changes = {}, header = {}, key = loginKeys.privateKey) {
    return sign({ iss: issuer, sub: 'external-user', aud: 'titan-login', jti: 'login-once', company_id: 'company-a', device_id: 'device-1',
      iat: epoch / 1000, exp: epoch / 1000 + 300, ...changes }, key, { alg: 'EdDSA', kid: 'test-login', typ: 'titan-login+jwt', ...header });
  }
  async function access(token, changes = {}, header = {}, key = keys.privateKey) {
    return sign({ ...decodeJwt(token), ...changes }, key, { alg: 'EdDSA', kid: 'test-access', typ: 'titan-session+jwt', ...header });
  }
  return { get storage() { return storage; }, get registry() { return registry; }, get service() { return service; }, policy, keys, loginKeys, wrongKeys,
    login, access, setTime: value => { at = value; },
    async restart() { await storage.close(); storage = createSqliteStorage(path); registry = await createIdentitySessionRegistry({ storage, storage_role: 'GLOBAL_REGISTRY' }); service = createSessionCredentialService({ ...policy, registry }); },
  };
}

const denied = promise => assert.rejects(promise, { message: 'authentication-denied' });
const registryUnavailable = promise => assert.rejects(promise, error => {
  assert.equal(error.message, 'identity-registry-unavailable');
  assert.equal(error.cause, undefined);
  assert.equal(error.message.includes('private database path'), false);
  return true;
});

test('real signed issuance binds current state and public consumers need no production credentials', async t => {
  const f = await fixture(t);
  const issued = await f.service.issue(await f.login(), expectation);
  const claims = decodeJwt(issued.credential);
  for (const field of ['iss','sub','aud','session_id','device_id','actor_id','company_id','session_revision','context_revision','identity_provider','iat','exp']) assert.ok(claims[field] !== undefined, field);
  assert.equal(claims.identity_provider, issuer);
  assert.equal(claims.session_id, issued.context.session_id);
  assert.equal(claims.exp, epoch / 1000 + 300);
  const verified = await f.service.authenticate(issued.credential, expectation);
  assert.equal(verified.provider, issuer);
  assert.equal(verified.subject, 'external-user');
  assert.deepEqual(verified.context, issued.context);
  assert.equal(verified.context.authority_neutral, true);
  assert.deepEqual([verified.context.company_id], ['company-a']);
  assert.deepEqual(verified.context.allowed_company_ids, ['company-a','company-b']);
  // A session credential is reusable authentication, never a one-use execution authorization.
  assert.deepEqual(await f.service.resolve(issued.credential, expectation), issued.context);
  assert.deepEqual(await f.service.resolve(issued.credential, expectation), issued.context);
  assert.equal('role' in claims, false);
  const rows = await f.storage.query('SELECT * FROM titan_security_sessions');
  assert.equal(JSON.stringify(rows).includes(issued.credential), false);
});

test('registry availability is distinct from invalid credentials and service recovers without bypass', async t => {
  const f = await fixture(t);
  const issued = await f.service.issue(await f.login(), expectation);
  const transaction = f.storage.transaction.bind(f.storage);
  let unavailable = true;
  let failureMode = 'transaction';
  let transactions = 0;
  f.storage.transaction = (callback, options) => {
    transactions++;
    if (unavailable && failureMode === 'transaction') return Promise.reject(new Error('private database path unavailable'));
    if (unavailable) return transaction(tx => callback({ ...tx,
      query: async () => { throw new Error('private database path unavailable'); },
    }), options);
    return transaction(callback, options);
  };

  const invalid = await f.access(issued.credential, {}, {}, f.wrongKeys.privateKey);
  const beforeInvalid = transactions;
  await denied(f.service.authenticate(invalid, expectation));
  assert.equal(transactions, beforeInvalid, 'invalid signature is rejected before registry access');
  await registryUnavailable(f.service.authenticate(issued.credential, expectation));
  failureMode = 'query';
  await registryUnavailable(f.service.authenticate(issued.credential, expectation));

  unavailable = false;
  assert.equal((await f.service.authenticate(issued.credential, expectation)).context.session_id, issued.context.session_id);
  await f.service.revoke(issued.credential, expectation);
  await denied(f.service.authenticate(issued.credential, expectation));
});

test('registry revoke-query outage is reported as unavailable and retry revokes after recovery', async t => {
  const f = await fixture(t);
  const issued = await f.service.issue(await f.login(), expectation);
  const query = f.storage.query.bind(f.storage);
  f.storage.query = async () => { throw new Error('private database path unavailable'); };

  await registryUnavailable(f.service.revoke(issued.credential, expectation));
  f.storage.query = query;
  assert.equal((await f.service.authenticate(issued.credential, expectation)).context.session_id, issued.context.session_id,
    'failed revoke does not claim revocation or mutate session state');
  await f.service.revoke(issued.credential, expectation);
  await denied(f.service.authenticate(issued.credential, expectation));
});

for (const [label, change, header, keyKind] of [
  ['issuer', {iss:'https://attacker.test'}], ['audience', {aud:'other'}], ['audience array', {aud:['titan-login','other']}],
  ['missing expiry', {exp:undefined}], ['expired', {exp:epoch/1000}], ['future', {iat:epoch/1000+1}],
  ['overlong lifetime', {exp:epoch/1000+301}], ['fractional time', {iat:epoch/1000-.5}],
  ['missing nonce', {jti:undefined}], ['empty subject', {sub:''}], ['device', {device_id:'device-2'}], ['company', {company_id:'company-b'}],
  ['key identifier', {}, {kid:'untrusted'}], ['wrong type', {}, {typ:'JWT'}], ['remote key URL', {}, {jku:'https://attacker.test/key'}],
  ['wrong key', {}, {}, 'wrong'], ['wrong algorithm', {}, {alg:'HS256'}, 'symmetric'],
]) test(`issuance rejects ${label} before registry lookup`, async t => {
  const f = await fixture(t);
  let looked = false;
  f.registry.issueSession = async () => { looked = true; throw new Error('lookup'); };
  const key = keyKind === 'wrong' ? f.wrongKeys.privateKey : keyKind === 'symmetric' ? crypto.getRandomValues(new Uint8Array(32)) : undefined;
  await denied(f.service.issue(await f.login(change, header, key), expectation));
  assert.equal(looked, false);
});

for (const [label, changes, header, keyKind] of [
  ['issuer', {iss:'titan:other'}], ['audience', {aud:'directadmin'}], ['array audience', {aud:['workforce']}],
  ['provider', {identity_provider:'directadmin:https://da-other.example.test'}], ['company', {company_id:'company-b'}],
  ['device', {device_id:'device-2'}], ['actor', {actor_id:'actor-other'}], ['session', {session_id:'missing'}],
  ['revision', {session_revision:2}], ['context generation', {context_revision:'stale'}],
  ['unsafe revision', {session_revision:Number.MAX_SAFE_INTEGER+1}], ['missing revision', {session_revision:undefined}],
  ['expiry', {exp:epoch/1000}], ['missing issuance', {iat:undefined}], ['future issuance', {iat:epoch/1000+1}],
  ['too long', {exp:epoch/1000+901}], ['fractional expiry', {exp:epoch/1000+299.5}],
  ['key id', {}, {kid:'unknown'}], ['type', {}, {typ:'titan-login+jwt'}], ['key URL', {}, {x5u:'https://attacker.test/key'}],
  ['wrong key', {}, {}, 'wrong'], ['algorithm confusion', {}, {alg:'HS256'}, 'symmetric'],
]) test(`access rejects signed ${label}`, async t => {
  const f = await fixture(t);
  const issued = await f.service.issue(await f.login(), expectation);
  const key = keyKind === 'wrong' ? f.wrongKeys.privateKey : keyKind === 'symmetric' ? crypto.getRandomValues(new Uint8Array(32)) : undefined;
  await denied(f.service.resolve(await f.access(issued.credential, changes, header, key), expectation));
});

test('tamper, unsigned JWT and legacy tokens cannot reach lookup or switch/provision', async t => {
  const f = await fixture(t);
  const issued = await f.service.issue(await f.login(), expectation);
  const parts = issued.credential.split('.');
  const payload = Buffer.from(JSON.stringify({ ...decodeJwt(issued.credential), company_id:'company-b' })).toString('base64url');
  const legacy = await new SignJWT({userId:'actor-1',accountId:'company-a',role:'owner'}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('7d').sign(crypto.getRandomValues(new Uint8Array(32)));
  let calls = 0;
  for (const name of ['resolveCurrentSession','issueSession','switchCompany','revokeSession']) f.registry[name] = async () => { calls++; throw new Error('lookup'); };
  for (const token of [parts[0]+'.'+payload+'.'+parts[2], Buffer.from('{"alg":"none"}').toString('base64url')+'.'+parts[1]+'.', legacy, issued.context.session_id, '', 'a'.repeat(16385)]) {
    await denied(f.service.resolve(token, expectation));
    await denied(f.service.issue(token, expectation));
    await denied(f.service.switchCompany(token, expectation, 'company-b'));
    await denied(f.service.revoke(token, expectation));
  }
  assert.equal(calls, 0);
});

test('one-time assertion cannot be exchanged twice, concurrently or after restart/revocation', async t => {
  const f = await fixture(t);
  const assertion = await f.login();
  const results = await Promise.allSettled([f.service.issue(assertion, expectation), f.service.issue(assertion, expectation)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length, 1);
  const {credential} = results.find(r=>r.status==='fulfilled').value;
  await f.restart();
  await denied(f.service.issue(assertion, expectation));
  await f.service.revoke(credential, expectation);
  await f.restart();
  await denied(f.service.resolve(credential, expectation));
  await denied(f.service.issue(assertion, expectation));
});

test('atomic A-B-A switching rejects old generations and wrong-company replay after restart', async t => {
  const f = await fixture(t);
  const a = await f.service.issue(await f.login(), expectation);
  const b = await f.service.switchCompany(a.credential, expectation, 'company-b');
  assert.equal(b.context.company_role, 'tech');
  await denied(f.service.resolve(a.credential, expectation));
  await denied(f.service.resolve(b.credential, expectation));
  const back = await f.service.switchCompany(b.credential, {...expectation,company_id:'company-b'}, 'company-a');
  await f.restart();
  assert.equal((await f.service.resolve(back.credential, expectation)).session_revision, 3);
  await denied(f.service.resolve(a.credential, expectation));
  await denied(f.service.switchCompany(b.credential, {...expectation,company_id:'company-b'}, 'company-a'));
});

for (const kind of ['actor','company','membership','device','binding']) test(`current ${kind} revocation/reactivation never revives signed credentials`, async t => {
  const f = await fixture(t);
  const old = await f.service.issue(await f.login(), expectation);
  const change = (status, revision) => ({
    actor: ()=>f.registry.putActor({actor_id:'actor-1',status},revision),
    company: ()=>f.registry.putCompany({company_id:'company-a',status},revision),
    membership: ()=>f.registry.putMembership({actor_id:'actor-1',company_id:'company-a',role:'owner',status},revision),
    device: ()=>f.registry.putDevice({actor_id:'actor-1',device_id:'device-1',status},revision),
    binding: ()=>f.registry.putExternalBinding({provider:issuer,subject:'external-user',actor_id:'actor-1',company_id:'company-a',binding_id:'binding-company-a',status},revision),
  })[kind]();
  await change('revoked',1);
  await denied(f.service.resolve(old.credential,expectation));
  await change('active',2);
  await f.restart();
  await denied(f.service.resolve(old.credential,expectation));
  const fresh = await f.service.issue(await f.login({jti:'reauth-new'}),expectation);
  assert.equal((await f.service.resolve(fresh.credential,expectation)).actor_id,'actor-1');
});

test('unknown membership is never reconstructed and failures disclose no credential or SQL', async t => {
  const f = await fixture(t);
  await f.storage.query('DELETE FROM titan_security_memberships WHERE company_id=$1',['company-a']);
  await denied(f.service.issue(await f.login(),expectation));
  assert.equal((await f.storage.query('SELECT * FROM titan_security_sessions')).rows.length,0);
  assert.equal((await f.storage.query('SELECT * FROM titan_security_memberships WHERE company_id=$1',['company-a'])).rows.length,0);
});

test('expiry checked on each use and refresh/replay cannot extend it', async t => {
  const f = await fixture(t);
  const old = await f.service.issue(await f.login({exp:epoch/1000+20}),expectation);
  f.setTime(epoch+19000);
  const switched = await f.service.switchCompany(old.credential,expectation,'company-b');
  assert.equal(decodeJwt(switched.credential).exp,epoch/1000+20);
  f.setTime(epoch+20000);
  await denied(f.service.resolve(switched.credential,{...expectation,company_id:'company-b'}));
});

test('host namespaces and duplicate usernames remain isolated', async t => {
  assert.notEqual(directAdminIssuer('https://da-one.example.test'),directAdminIssuer('https://da-two.example.test'));
  for (const value of ['http://da.example.test','https://u:p@da.example.test','https://da.example.test/path','https://da.example.test?x=1']) assert.throws(()=>directAdminIssuer(value));
  const f = await fixture(t);
  const otherIssuer = 'https://idp-two.example.test';
  const other = createSessionCredentialService({...f.policy,registry:f.registry,upstream:{...f.policy.upstream,issuer:otherIssuer}});
  await denied(other.issue(await f.login({iss:otherIssuer}),expectation));
  const old = await f.service.issue(await f.login(),expectation);
  await denied(other.resolve(old.credential,expectation));
  assert.throws(()=>createSessionCredentialService({...f.policy,registry:f.registry,upstream:{...f.policy.upstream,issuer:'directadmin'}}));
});

test('DA adapter receives authenticated CSRF/node metadata preserved through switch, never authority', async t => {
  const f = await fixture(t,{audience:'directadmin-browser',directadmin:{node_id:'node-one'}});
  const channel = { node_id:'node-one', csrf_sha256:Buffer.from(await crypto.subtle.digest('SHA-256',crypto.getRandomValues(new Uint8Array(32)))).toString('base64url'), da_role:'admin' };
  await denied(f.service.issue(await f.login(),expectation));
  await denied(f.service.issue(await f.login({...channel,node_id:'node-two'}),expectation));
  const issued = await f.service.issue(await f.login(channel),expectation);
  const authenticated = await f.service.authenticate(issued.credential,expectation);
  assert.deepEqual(authenticated.directadmin,channel);
  assert.equal('authority' in authenticated,false);
  const b = await f.service.switchCompany(issued.credential,expectation,'company-b');
  assert.deepEqual((await f.service.authenticate(b.credential,{...expectation,company_id:'company-b'})).directadmin,channel);
  await denied(f.service.authenticate(await f.access(b.credential,{node_id:'node-two'}),{...expectation,company_id:'company-b'}));
});

test('misconfigured signing pair fails before consuming login or rotating existing session', async t => {
  const f = await fixture(t);
  const broken = createSessionCredentialService({...f.policy,registry:f.registry,signing_key:f.wrongKeys.privateKey});
  const assertion = await f.login();
  await denied(broken.issue(assertion,expectation));
  assert.equal((await f.storage.query('SELECT * FROM titan_security_sessions')).rows.length,0);
  const issued = await f.service.issue(assertion,expectation);
  await denied(broken.switchCompany(issued.credential,expectation,'company-b'));
  assert.equal((await f.service.resolve(issued.credential,expectation)).session_revision,1);
});

test('verification-only hosts can authenticate signed selection without any signing key', async t => {
  const { createSessionCredentialVerifier } = await import('../.test-dist/security-boundary.js');
  const f = await fixture(t);
  const issued = await f.service.issue(await f.login(),expectation);
  const verifier = createSessionCredentialVerifier({...f.policy,registry:f.registry,signing_key:undefined});
  const result = await verifier.authenticate(issued.credential);
  assert.equal(result.context.session_id,issued.context.session_id);
  assert.deepEqual(Object.keys(verifier),['authenticate','resolve']);
  await denied(verifier.resolve(issued.credential,{...expectation,company_id:'company-b'}));
  const readonly = createSessionCredentialService({...f.policy,registry:f.registry,signing_key:undefined});
  await denied(readonly.switchCompany(issued.credential,expectation,'company-b'));
  assert.equal((await verifier.resolve(issued.credential,expectation)).session_revision,1);
});

for (const algorithm of ['ES256','RS256','HS256']) test(`configured ${algorithm} uses the same verified durable contract`, async t => {
  const key = algorithm === 'HS256' ? crypto.getRandomValues(new Uint8Array(32)) : await generateKeyPair(algorithm);
  const f = await fixture(t,{algorithm,signing_key:key.privateKey??key,verification_key:key.publicKey??key});
  const issued = await f.service.issue(await f.login(),expectation);
  assert.equal((await f.service.resolve(issued.credential,expectation)).company_id,'company-a');
});

test('failed switch leaves old context valid, racing switches admit only one transition', async t => {
  const f = await fixture(t);
  const old = await f.service.issue(await f.login(),expectation);
  await denied(f.service.switchCompany(old.credential,expectation,'unknown'));
  assert.equal((await f.service.resolve(old.credential,expectation)).session_revision,1);
  const results = await Promise.allSettled([f.service.switchCompany(old.credential,expectation,'company-b'),f.service.switchCompany(old.credential,expectation,'company-b')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  await denied(f.service.resolve(old.credential,expectation));
});

test('only authenticate permits omitted expectation at JavaScript boundaries', async t => {
  const f = await fixture(t);
  const old = await f.service.issue(await f.login(),expectation);
  await denied(f.service.resolve(old.credential,undefined));
  await denied(f.service.switchCompany(old.credential,undefined,'company-b'));
  await denied(f.service.revoke(old.credential,undefined));
  assert.equal((await f.service.authenticate(old.credential)).context.session_revision,1);
});

test('configured symmetric key snapshots are detached even for Node Buffer inputs', async t => {
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  const f = await fixture(t,{algorithm:'HS256',signing_key:key,verification_key:key});
  const original = key.toString('hex');
  key.fill(0);
  const issued = await f.service.issue(await f.login(),expectation);
  const { jwtVerify } = await import('jose');
  assert.equal((await jwtVerify(issued.credential,Buffer.from(original,'hex'),{currentDate:new Date(epoch)})).payload.company_id,'company-a');
  await assert.rejects(jwtVerify(issued.credential,key,{currentDate:new Date(epoch)}));
});
