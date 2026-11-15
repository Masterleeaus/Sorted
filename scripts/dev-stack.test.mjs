import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'fsm-dev-stack-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  copyFileSync(new URL('./dev-stack.sh', import.meta.url), join(root, 'scripts/dev-stack.sh'));
  writeFileSync(join(root, 'bin/docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(root, 'bin/pnpm'), '#!/bin/sh\nprintf "%s %s %s %s\\n" "$1" "$DATABASE_URL" "$MIGRATION_DATABASE_URL" "$PGPASSWORD" >> "$AUDIT_TEST_LOG"\n', { mode: 0o755 });
  return root;
}

test('local dev setup never forwards ambient migration credentials', () => {
  const root = setup();
  try {
    const password = randomBytes(16).toString('hex');
    const log = join(root, 'calls');
    const result = spawnSync('bash', [join(root, 'scripts/dev-stack.sh'), 'up'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, AUDIT_TEST_LOG: log,
        POSTGRES_PORT: '15499', DEV_DB_PASSWORD: password,
        DATABASE_URL: 'postgres://remote/runtime', MIGRATION_DATABASE_URL: 'postgres://remote/admin' },
    });
    assert.equal(result.status, 0, result.stderr);
    const local = 'postgresql://ai_fsm@127.0.0.1:15499/ai_fsm';
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [
      `db:migrate ${local} ${local} ${password}`,
      `db:seed ${local} ${local} ${password}`,
    ]);
    assert.ok(!result.stdout.includes(password), 'password must not be printed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dev stack fails fast with a clear message when DEV_DB_PASSWORD is unset', () => {
  const root = setup();
  try {
    const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, AUDIT_TEST_LOG: join(root, 'calls') };
    delete env.DEV_DB_PASSWORD;
    const result = spawnSync('bash', [join(root, 'scripts/dev-stack.sh'), 'up'], { encoding: 'utf8', env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DEV_DB_PASSWORD/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
