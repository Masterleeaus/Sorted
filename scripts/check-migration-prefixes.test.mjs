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
