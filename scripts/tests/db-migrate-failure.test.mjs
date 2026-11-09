import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const script = resolve("scripts/db-migrate.sh");
function fixture(state = "fresh") {
  const root = mkdtempSync(join(tmpdir(), "sorted-db-migrate-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const log = join(root, "calls.txt");
  const psql = join(bin, "psql");
  writeFileSync(psql, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$MOCK_PSQL_LOG"
case "$*" in
  *current_database*) echo aifsm_test; exit 0 ;;
  *migration-state.sql*) printf '%s\\n' "$MOCK_MIGRATION_STATE"; exit 0 ;;
  *is-migration-applied.sql*) echo 0; exit 0 ;;
esac
if [[ " $* " == *" -1 "* ]]; then
  exit 37
fi
exit 0
`, { mode: 0o755 });
  function run() {
    return spawnSync("bash", [script], {
      encoding: "utf8", timeout: 15_000,
      env: { ...process.env,
        PATH: bin + ":" + process.env.PATH,
        MIGRATION_DATABASE_URL: "postgresql://fake/fake",
        POSTGRES_DB: "aifsm_test", POSTGRES_USER: "test",
        MOCK_MIGRATION_STATE: state, MOCK_PSQL_LOG: log,
      },
    });
  }
  return { root, log, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
test("an existing untracked schema aborts before attempting SQL migrations", () => {
  const f = fixture("untracked");
  try {
    const result = f.run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /no trustworthy migration tracking/);
    const log = readFileSync(f.log, "utf8");
    assert.doesNotMatch(log, / -1 /);
  } finally { f.cleanup(); }
});
test("a migration SQL failure propagates and blocks the completed status", () => {
  const f = fixture("fresh");
  try {
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /migrations complete/);
    const log = readFileSync(f.log, "utf8");
    assert.match(log, / -1 /);
    assert.match(log, /assert-migration-pending.sql/);
    assert.match(log, /record-migration.sql/);
  } finally { f.cleanup(); }
});
