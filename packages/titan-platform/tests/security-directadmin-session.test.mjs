import test from 'node:test';
import assert from 'node:assert/strict';
import { tsImport } from 'tsx/esm/api';

const { parseDirectAdminSessionInfo, projectDirectAdminSessionIdentity } = await tsImport(
  '../src/security-session-credentials.ts', { parentURL: import.meta.url, tsconfig: false },
);

const session = (changes = {}) => ({
  effectiveRole: 'user',
  effectiveUsername: 'effective-user',
  realUsername: 'effective-user',
  // DirectAdmin returns many unrelated required fields. The auth projection
  // deliberately neither requires nor copies them.
  allowedCommands: ['CMD_USER_STATS'],
  directadminConfig: { api: true },
  ...changes,
});

test('projects the effective account as subject and preserves login-as provenance', () => {
  const projected = projectDirectAdminSessionIdentity('https://da.example.test:2222', session({
    effectiveRole: 'user', effectiveUsername: 'managed-user', realUsername: 'operator-admin',
  }));

  assert.deepEqual(projected, {
    issuer: 'directadmin:https://da.example.test:2222',
    subject: 'managed-user',
    real_subject: 'operator-admin',
    da_role: 'user',
    impersonating: true,
  });
  assert.equal('actor_id' in projected, false);
  assert.equal('company_id' in projected, false);
  assert.equal('device_id' in projected, false);
  assert.equal('authority' in projected, false);
});

test('equal effective and real users are marked as non-impersonated', () => {
  const projected = projectDirectAdminSessionIdentity('https://da.example.test:2222', session());
  assert.equal(projected.subject, 'effective-user');
  assert.equal(projected.real_subject, 'effective-user');
  assert.equal(projected.impersonating, false);
});

test('role enum is presentation data only and unrelated response fields are discarded', () => {
  for (const role of ['admin', 'reseller', 'user']) {
    const parsed = parseDirectAdminSessionInfo(session({
      effectiveRole: role,
      password: 'test-secret-must-not-project',
      access_token: 'test-token-must-not-project',
    }));
    assert.deepEqual(Object.keys(parsed).sort(), ['effectiveRole', 'effectiveUsername', 'realUsername']);
    assert.equal(parsed.effectiveRole, role);
    assert.equal(JSON.stringify(parsed).includes('test-secret'), false);
  }
});

for (const [label, input] of [
  ['missing role', { effectiveUsername: 'u', realUsername: 'u' }],
  ['unknown role', session({ effectiveRole: 'root' })],
  ['missing effective username', { effectiveRole: 'user', realUsername: 'u' }],
  ['missing real username', { effectiveRole: 'user', effectiveUsername: 'u' }],
  ['non-string effective username', session({ effectiveUsername: 7 })],
  ['non-string real username', session({ realUsername: null })],
  ['empty username', session({ effectiveUsername: '' })],
  ['trimmed username', session({ effectiveUsername: ' user ' })],
  ['control character username', session({ realUsername: 'admin\nforged' })],
  ['oversized username', session({ effectiveUsername: 'u'.repeat(257) })],
  ['array response', []],
  ['null response', null],
  ['non-object response', 'session'],
]) {
  test(`fails closed on DirectAdmin identity schema mismatch: ${label}`, () => {
    assert.throws(() => parseDirectAdminSessionInfo(input), {
      message: 'directadmin-session-schema-unsupported',
    });
  });
}

test('does not evaluate accessor-backed identity fields', () => {
  let read = false;
  const input = Object.defineProperties({}, {
    effectiveRole: { enumerable: true, get() { read = true; return 'admin'; } },
    effectiveUsername: { enumerable: true, value: 'user' },
    realUsername: { enumerable: true, value: 'user' },
  });

  assert.throws(() => parseDirectAdminSessionInfo(input), {
    message: 'directadmin-session-schema-unsupported',
  });
  assert.equal(read, false);
});

test('projects a separately configured HTTPS issuer per DirectAdmin host', () => {
  const one = projectDirectAdminSessionIdentity('https://da-one.example.test:2222', session());
  const two = projectDirectAdminSessionIdentity('https://da-two.example.test:2222', session());
  assert.notEqual(one.issuer, two.issuer);
  for (const origin of [
    'http://da.example.test:2222',
    'https://user:password@da.example.test:2222',
    'https://da.example.test:2222/path',
  ]) assert.throws(() => projectDirectAdminSessionIdentity(origin, session()));
});
