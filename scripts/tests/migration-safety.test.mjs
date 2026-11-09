import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const helper = resolve("scripts/lib/migration-safety.sh");
const run = (cmd, ...args) => spawnSync("bash", ["-c", `source "$1"; ${cmd}`, "_", helper, ...args], { encoding: "utf8" });

test("migration history refuses populated untracked schemas", () => {
  assert.equal(run('sorted_assert_tracking_state untracked').status, 1);
  assert.equal(run('sorted_assert_tracking_state fresh').status, 0);
  assert.equal(run('sorted_assert_tracking_state tracked').status, 0);
  assert.equal(run('sorted_assert_tracking_state nonsense').status, 1);
});
test("migration identity refuses reserved databases and missing owners", () => {
  for (const name of ["postgres", "template0", "template1"]) {
    assert.equal(run(`sorted_validate_db_identity ${name} admin`).status, 1);
  }
  assert.equal(run("sorted_validate_db_identity tenant_db admin").status, 0);
  assert.equal(run('sorted_validate_db_identity tenant_db ""').status, 1);
});
test("migration inventory includes valid source but not dev seed", () => {
  const dir = mkdtempSync(join(tmpdir(), "sorted-migrations-"));
  try {
    writeFileSync(join(dir, "001_accounts.sql"), "SELECT 1;");
    writeFileSync(join(dir, "002_seed_dev.sql"), "SELECT 2;");
    const result = run('sorted_migration_files "$2"', dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /001_accounts.sql/);
    assert.doesNotMatch(result.stdout, /002_seed_dev.sql/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("unexpected and empty migration inventories fail closed", () => {
  const dir = mkdtempSync(join(tmpdir(), "sorted-migrations-bad-"));
  try {
    assert.equal(run('sorted_migration_files "$2"', dir).status, 1);
    writeFileSync(join(dir, "001_accounts.sql"), "SELECT 1;");
    writeFileSync(join(dir, "TRIGGER_UNSAFE.sql"), "SELECT 2;");
    assert.equal(run('sorted_migration_files "$2"', dir).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
