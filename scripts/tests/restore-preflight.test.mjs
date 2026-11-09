import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const script = resolve("scripts/restore-garonhome.sh");
function prepare() {
  const root = mkdtempSync(join(tmpdir(), "sorted-restore-preflight-"));
  const backups = join(root, "backups");
  mkdirSync(backups);
  const dump = join(backups, "ai_fsm_20260101T010101Z.dump.gpg");
  writeFileSync(dump, "fixture-only");
  const envFile = join(root, ".env");
  writeFileSync(envFile, "POSTGRES_DB=test_database\nPOSTGRES_USER=test_owner\n");
  const passphrase = join(root, "backup.passphrase");
  writeFileSync(passphrase, "test-only-passphrase");
  return {
    root, backups, dump, passphrase,
    run() {
      return spawnSync("bash", [script, dump], {
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, FSM_DEPLOY_ROOT: root, FSM_ENV_FILE: envFile, FSM_BACKUP_PASSPHRASE_FILE: passphrase },
      });
    },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}
test("restore refuses to drop any database when the manifest is absent", () => {
  const f = prepare();
  try {
    const result = f.run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /checksum manifest missing/);
    assert.doesNotMatch(result.stderr, /waiting for web/);
  } finally { f.cleanup(); }
});
test("restore refuses an incomplete set even with a valid dump checksum manifest", () => {
  const f = prepare();
  try {
    const hash = spawnSync("sha256sum", [f.dump], { encoding: "utf8" });
    assert.equal(hash.status, 0);
    writeFileSync(join(f.backups, "ai_fsm_20260101T010101Z.sha256"),
      hash.stdout.replace(f.dump, "ai_fsm_20260101T010101Z.dump.gpg"));
    const result = f.run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /missing required artifact/);
  } finally { f.cleanup(); }
});
test("restore SQL uses psql-escaped variables and a literal heredoc", () => {
  const source = readFileSync(script, "utf8");
  assert.match(source, /-v "target_db=\$\{POSTGRES_DB\}"/);
  assert.match(source, /<<'SQL'/);
  assert.match(source, /datname = :'target_db'/);
  assert.match(source, /DROP DATABASE IF EXISTS :"target_db"/);
  assert.match(source, /OWNER :"target_owner"/);
  assert.doesNotMatch(source, /DROP DATABASE IF EXISTS \$\{POSTGRES_DB\}/);
});

test("restore blocks the postgres system database before any manifest or service teardown", () => {
  const f = prepare();
  try {
    const envFile = join(f.root, ".env");
    writeFileSync(envFile, "POSTGRES_DB=postgres\nPOSTGRES_USER=test_owner\n");
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing or unsafe target database/);
  } finally { f.cleanup(); }
});
test("restore blocks unencrypted dumps before any database teardown", () => {
  const f = prepare();
  try {
    const plain = join(f.backups, "ai_fsm_20260101T010101Z.dump");
    writeFileSync(plain, "plain");
    const result = spawnSync("bash", [script, plain], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, FSM_DEPLOY_ROOT: f.root, FSM_ENV_FILE: join(f.root, ".env"), FSM_BACKUP_PASSPHRASE_FILE: f.passphrase },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /only encrypted/);
  } finally { f.cleanup(); }
});
