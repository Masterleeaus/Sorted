import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const sql = name => readFileSync(`scripts/sql/${name}.sql`, "utf8");

test("migration tracking lookup binds filename as a psql literal", () => {
  const source = sql("is-migration-applied");
  assert.match(source, /filename = :'migration_filename'/);
  assert.doesNotMatch(source, /filename = '\$\{filename\}'/);
});
test("migration registry insertion is parameterized", () => {
  assert.match(sql("record-migration"), /VALUES \(:'migration_filename'\)/);
});
test("migration replay guard follows a database advisory lock", () => {
  assert.match(sql("migration-lock"), /pg_advisory_xact_lock\(/);
  const guard = sql("assert-migration-pending");
  assert.match(guard, /set_config\('sorted.migration_filename'/);
  assert.match(guard, /RAISE EXCEPTION 'migration already applied/);
  assert.match(guard, /current_setting\('sorted.migration_filename'\)/);
});
test("any untracked user table prevents treating a database as fresh", () => {
  const state = sql("migration-state");
  assert.match(state, /pg_catalog\.pg_tables/);
  assert.match(state, /schemaname = 'public'/);
  assert.match(state, /tablename <> 'schema_migrations'/);
  assert.match(state, /THEN 'untracked'/);
  assert.match(state, /ELSE 'fresh'/);
});
