import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const src = readFileSync("scripts/deploy-garonhome.sh", "utf8");
test("deployment uses shared strict migration inventory and fails untracked schema", () => {
  assert.match(src, /source "\$\{REPO_ROOT\}\/scripts\/lib\/migration-safety.sh"/);
  assert.match(src, /sorted_migration_files/);
  assert.match(src, /sorted_assert_tracking_state/);
  assert.doesNotMatch(src, /seeding tracking record \(pre-existing migration\)/);
});
test("deployment executes migration and registry in one psql transaction", () => {
  assert.match(src, /migration-lock.sql/);
  assert.match(src, /assert-migration-pending.sql/);
  assert.match(src, /record-migration.sql/);
  assert.match(src, /pg_exec -X -1 -v ON_ERROR_STOP=1/);
  assert.match(src, /-f -/);
  assert.match(src, /sql_bundle="\$\(mktemp\)"/);
  assert.match(src, /trap 'rm -f -- "\$\{sql_bundle\}"' EXIT/);
  assert.match(src, /-f - < "\$\{sql_bundle\}"/);
});
test("no SQL filename values are injected into literal statements", () => {
  assert.match(src, /-v "migration_filename=\$\{filename\}"/);
  assert.doesNotMatch(src, /WHERE filename = '\$\{filename\}'/);
  assert.doesNotMatch(src, /VALUES \('\$\{filename\}'\)/);
});
test("deployment provisions runtime roles after migration completion", () => {
  assert.ok(src.indexOf("record-migration.sql") < src.indexOf("provision_runtime_role ai_fsm_worker"));
});
