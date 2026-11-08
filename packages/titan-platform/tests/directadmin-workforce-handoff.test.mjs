import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { tsImport } from 'tsx/esm/api';

const security = await tsImport('../src/security-boundary.ts', { parentURL: import.meta.url, tsconfig: false });
const { createSqliteStorage } = await tsImport('@titan-zero/storage', { parentURL: import.meta.url, tsconfig: false });
const { createIdentitySessionRegistry, createSessionCredentialService,
  createSessionCredentialVerifier, directAdminIssuer } = security;

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'titan-da-workforce-'));
  const storage = createSqliteStorage(join(directory, 'identity.sqlite'));
  t.after(async () => { await storage.close(); rmSync(directory, { recursive: true, force: true }); });

  const registry = await createIdentitySessionRegistry({ storage, storage_role: 'GLOBAL_REGISTRY' });
  const provider = directAdminIssuer('https://panel.example.test');
  const audience = 'titan-login:node-a';
  const expectation = { company_id: 'company-a', device_id: 'device-a' };
  await registry.putActor({ actor_id: 'actor-a', status: 'active' }, null);
  await registry.putDevice({ device_id: 'device-a', actor_id: 'actor-a', status: 'active' }, null);
  for (const company_id of ['company-a', 'company-b']) {
    await registry.putCompany({ company_id, status: 'active' }, null);
    await registry.putMembership({ actor_id: 'actor-a', company_id, role: 'owner', status: 'active' }, null);
    await registry.putExternalBinding({ binding_id: `binding-${company_id}`, provider, subject: 'subject-a',
      actor_id: 'actor-a', company_id, status: 'active' }, null);
  }

  const upstream = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const directadmin = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const workforce = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const upstreamTrust = { issuer: provider, audience, key_id: 'upstream-a',
    algorithm: 'EdDSA', verification_key: upstream.publicKey };
  const directadminNode = { node_id: 'node-a' };
  const now = Math.floor(Date.now() / 1000);
  const csrfNonce = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const csrfHash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(csrfNonce))).toString('base64url');

  const directadminService = createSessionCredentialService({ registry, upstream: upstreamTrust,
    issuer: 'titan:node-a', audience: 'titan-directadmin:node-a', key_id: 'da-a', algorithm: 'EdDSA',
    verification_key: directadmin.publicKey, signing_key: directadmin.privateKey, directadmin: directadminNode,
    workforce_zero_exchange: { issuer: 'titan:workforce', key_id: 'workforce-a', algorithm: 'EdDSA',
      verification_key: workforce.publicKey, signing_key: workforce.privateKey, lifetime_seconds: 120 } });
  const workforceVerifier = createSessionCredentialVerifier({ registry, upstream: upstreamTrust,
    issuer: 'titan:workforce', audience: 'workforce', key_id: 'workforce-a', algorithm: 'EdDSA',
    verification_key: workforce.publicKey, lifetime_seconds: 120, directadmin: directadminNode });

  async function loginAssertion(jti) {
    return new SignJWT({ company_id: 'company-a', device_id: 'device-a', jti,
      node_id: 'node-a', da_role: 'admin', csrf_sha256: csrfHash })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'upstream-a', typ: 'titan-login+jwt' })
      .setIssuer(provider).setAudience(audience).setSubject('subject-a')
      .setIssuedAt(now).setExpirationTime(now + 120).sign(upstream.privateKey);
  }

  return { directadminService, workforceVerifier, expectation, loginAssertion };
}

for (const invalidation of ['company switch', 'revocation']) test(`fixed DA-to-Workforce exchange child is rejected after source ${invalidation}`, async t => {
  const f = await fixture(t);
  const source = await f.directadminService.issue(await f.loginAssertion(`da-login-${invalidation.replace(' ', '-')}`), f.expectation);
  await assert.rejects(f.workforceVerifier.authenticate(source.credential), /authentication-denied/);

  const child = await f.directadminService.exchangeWorkforceZero(source.credential, f.expectation);
  const authenticatedChild = await f.workforceVerifier.authenticate(child.credential);
  assert.equal(authenticatedChild.context.audience, 'workforce');
  assert.equal(authenticatedChild.context.company_id, 'company-a');
  assert.equal(authenticatedChild.source_session.session_id, source.context.session_id);
  assert.equal(authenticatedChild.source_session.context_revision, source.context.context_revision);

  if (invalidation === 'company switch') {
    const switched = await f.directadminService.switchCompany(source.credential, f.expectation, 'company-b');
    assert.equal((await f.directadminService.authenticate(switched.credential)).context.company_id, 'company-b');
    await assert.rejects(f.directadminService.authenticate(source.credential), /authentication-denied/);
  } else {
    await f.directadminService.revoke(source.credential, f.expectation);
    await assert.rejects(f.directadminService.authenticate(source.credential), /authentication-denied/);
  }

  await assert.rejects(f.workforceVerifier.authenticate(child.credential), /authentication-denied/);
});
