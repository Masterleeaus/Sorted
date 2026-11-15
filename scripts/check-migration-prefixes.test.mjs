import assert from "node:assert/strict";
import test from "node:test";
import { checkMigrationPrefixes, GRANDFATHERED } from "./check-migration-prefixes.mjs";

test("current grandfathered sets pass", () => {
  const files = Object.values(GRANDFATHERED).flat();
  files.push("176_something.sql", "177_invoice_kind_progress.sql");
  const result = checkMigrationPrefixes(files);
  assert.equal(result.ok, true, result.errors.join("; "));
});

test("a new file on a frozen prefix fails", () => {
  const files = [...GRANDFATHERED[175], "175_new_thing.sql"];
  const result = checkMigrationPrefixes(files);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /prefix 175 is frozen/);
});

test("a second file on a unique prefix fails", () => {
  const result = checkMigrationPrefixes(["178_one.sql", "178_two.sql"]);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /prefix 178 collides/);
});

test("seed files and unprefixed names are ignored", () => {
  const result = checkMigrationPrefixes(["002_seed_dev.sql", "README.sql", "178_ok.sql"]);
  assert.equal(result.ok, true, result.errors.join("; "));
});

// Exact filename freezes preserve the migration ledger of existing deployments.
// These are not permissions to introduce further duplicate migration numbers.
test("existing main collisions 209 and 210 remain frozen by filename", () => {
  for (const prefix of [209, 210]) {
    const existing = GRANDFATHERED[prefix];
    assert.equal(existing.length, 2);
    assert.equal(checkMigrationPrefixes(existing).ok, true);
    const added = checkMigrationPrefixes([...existing, `${prefix}_unexpected_new_migration.sql`]);
    assert.equal(added.ok, false);
    assert.match(added.errors.join("; "), new RegExp(`prefix ${prefix} is frozen`));
  }
});

// Both 209 and 210 filenames are run on fresh CI databases. Migration 209
// renames the tenant column, so the later policy must not assume account_id.
test("pricing policy migration supports account_id and company_id schema generations", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const path = fileURLToPath(new URL("../db/migrations/210_rls_force_and_pricing_policy.sql", import.meta.url));
  const sql = readFileSync(path, "utf8");
  assert.match(sql, /c\.column_name IN \('company_id', 'account_id'\)/);
  assert.match(sql, /IF tenant_column IS NULL THEN[\s\S]*RAISE EXCEPTION/);
  assert.match(sql, /USING \(%I = app_account_id\(\)\) WITH CHECK \(%I = app_account_id\(\)\)/);
  assert.doesNotMatch(sql, /USING \(account_id = app_account_id\(\)\)\s*WITH CHECK \(account_id = app_account_id\(\)\)/);
});

// The CI seed runs after all numbered migrations, including 209's tenant rename.
test("development seed uses post-209 company_id for users", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const sql = readFileSync(fileURLToPath(new URL("../db/migrations/002_seed_dev.sql", import.meta.url)), "utf8");
  assert.match(sql, /insert into users \(id, company_id, email, full_name, password_hash, role\)/);
  assert.doesNotMatch(sql, /insert into users \(id, account_id,/);
});
