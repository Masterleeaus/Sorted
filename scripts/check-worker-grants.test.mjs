import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractWorkerSql,
  parseWorkerGrants,
  existingTables,
  checkWorkerGrants,
} from "./check-worker-grants.mjs";

const src = (text) => [{ name: "w.ts", text }];

test("extracts tables from SQL literals, including multi-line INSERT column lists", () => {
  const { tables } = extractWorkerSql(src(
    "await c.query(`INSERT INTO audit_log\n  (a, b) VALUES ($1, $2)`);\n" +
    "await c.query(`SELECT j.id FROM jobs j JOIN visits v ON v.job_id = j.id`);",
  ));
  assert.deepEqual([...tables.keys()].sort(), ["audit_log", "jobs", "visits"]);
});

test("ignores CTE names, function calls, prose and imports", () => {
  const { tables } = extractWorkerSql(src(
    "import { x } from \"./y.js\";\n" +
    "const s = `WITH recent AS (SELECT 1 FROM jobs) SELECT * FROM recent`;\n" +
    "const h = `<p>Please update the request status.</p>`;\n" +
    "await c.query(`SELECT * FROM generate_series(1, 2)`);",
  ));
  assert.deepEqual([...tables.keys()], ["jobs"]);
});

test("flags a worker query on a table with no worker grant (deliberate failure)", () => {
  const { tables, dynamic } = extractWorkerSql(src("await c.query(`DELETE FROM secret_table WHERE x = 1`);"));
  const granted = parseWorkerGrants("GRANT SELECT ON TABLE public.jobs TO ai_fsm_worker;");
  const res = checkWorkerGrants({ tables, dynamic, granted, existing: new Set(["jobs", "secret_table"]) });
  assert.equal(res.ok, false);
  assert.deepEqual(res.unlisted.map((u) => u.table), ["secret_table"]);
});

test("flags a grant for a table no migration creates", () => {
  const res = checkWorkerGrants({
    tables: new Map(), dynamic: [], granted: new Set(["jobz"]), existing: new Set(["jobs"]),
  });
  assert.equal(res.ok, false);
  assert.deepEqual(res.ungrantedTables, ["jobz"]);
});

test("flags .query() called with non-literal SQL", () => {
  const { dynamic } = extractWorkerSql(src("const q = build(); await c.query(q);"));
  assert.equal(dynamic.length, 1);
  assert.equal(checkWorkerGrants({ tables: new Map(), dynamic, granted: new Set(), existing: new Set() }).ok, false);
});

test("parseWorkerGrants reads only ai_fsm_worker grants, not web grants", () => {
  const granted = parseWorkerGrants([
    "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.jobs TO ai_fsm_worker;",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clients TO %I",
    "GRANT EXECUTE ON FUNCTION public.app_login_candidates(text) TO ai_fsm_web",
  ].join("\n"));
  assert.deepEqual([...granted], ["jobs"]);
});

test("existingTables includes ALTER TABLE RENAME targets", () => {
  const ex = existingTables([
    "CREATE TABLE automation_rules (id uuid);",
    "ALTER TABLE automation_rules RENAME TO automation_settings;",
  ]);
  assert.ok(ex.has("automation_settings"));
});

test("the real worker source passes against the real provisioner and migrations", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { readMigrationSqls } = await import("./check-rls-coverage.mjs");
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".ts") && !/\.test\.ts$/.test(e.name)
      ? [path.join(d, e.name)] : []);
  const files = walk(path.join(root, "services", "worker", "src")).map((f) => ({
    name: f, text: fs.readFileSync(f, "utf8"),
  }));
  const { tables, dynamic } = extractWorkerSql(files);
  const res = checkWorkerGrants({
    tables, dynamic,
    granted: parseWorkerGrants(fs.readFileSync(path.join(root, "scripts", "db-provision-runtime.sh"), "utf8")),
    existing: existingTables(readMigrationSqls(path.join(root, "db", "migrations"))),
  });
  assert.deepEqual(res.unlisted, []);
  assert.deepEqual(res.ungrantedTables, []);
  assert.deepEqual(res.dynamic, []);
});
