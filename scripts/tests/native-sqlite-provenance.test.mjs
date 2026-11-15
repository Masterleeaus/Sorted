import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { auditPinnedSqliteSources, PINNED_SQLITE_SOURCES } from "../check-native-sqlite-provenance.mjs";

test("source audit requires all four pinned migration artifacts", () => {
  const names = Object.keys(PINNED_SQLITE_SOURCES);
  assert.equal(names.length, 4);
  assert.ok(names.includes("db/sqlite/001_canonical.sql"));
  assert.ok(names.includes("db/sqlite/company-native/0002_visit_tasks.sql"));
  for (const sha of Object.values(PINNED_SQLITE_SOURCES)) {
    assert.match(sha, /^[0-9a-f]{64}$/);
  }
});
test("missing files and modified substitute SQL fail closed, without writing sources", () => {
  const root = mkdtempSync(join(tmpdir(), "sorted-sqlite-source-"));
  try {
    const initial = auditPinnedSqliteSources(root);
    assert.equal(initial.ok, false);
    assert.equal(initial.files.filter(f => f.status === "missing").length, 4);
    const file = "db/sqlite/001_canonical.sql";
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "CREATE TABLE companies(id TEXT);");
    const changed = auditPinnedSqliteSources(root);
    assert.equal(changed.ok, false);
    assert.equal(changed.files.find(f => f.path === file)?.status, "mismatch");
    assert.equal(changed.files.filter(f => f.status === "missing").length, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
