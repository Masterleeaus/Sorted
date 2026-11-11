import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Migration 205 (company foundation). Needs a database with all migrations applied,
// including 205. Writes run inside a transaction that is rolled back, so the
// database is left as it was found.
const enabled = !!process.env.TEST_DATABASE_URL;
if (process.env.CI && !enabled) {
  throw new Error("Company foundation integration requires TEST_DATABASE_URL");
}

const MIGRATION = path.resolve(__dirname, "../../../../db/migrations/205_company_foundation.sql");

describe.skipIf(!enabled)("company foundation (migration 205)", () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

  beforeAll(async () => {
    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public.companies') IS NOT NULL AS exists`,
    );
    if (!rows[0].exists) throw new Error("migration 205 is not applied to TEST_DATABASE_URL");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("(a) every account has a companies row with the same id", async () => {
    const { rows } = await pool.query<{ missing: string }>(
      `SELECT count(*)::text AS missing
       FROM accounts a LEFT JOIN companies c ON c.id = a.id
       WHERE c.id IS NULL`,
    );
    expect(rows[0].missing).toBe("0");
  });

  it("(b) company_id equals account_id on every tenant table, with no unset rows", async () => {
    const { rows: tables } = await pool.query<{ table_name: string }>(
      `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
         AND c.column_name = 'account_id' AND c.table_name NOT IN ('accounts', 'companies')`,
    );
    expect(tables.length).toBeGreaterThan(0);
    for (const { table_name } of tables) {
      const { rows } = await pool.query<{ bad: string }>(
        `SELECT count(*)::text AS bad FROM "${table_name}"
         WHERE company_id IS DISTINCT FROM account_id`,
      );
      expect(rows[0].bad, table_name).toBe("0");
    }
  });

  it("(c) the trigger fills the missing column on insert and update, and rejects a mismatch", async () => {
    const accountId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO accounts (id, name) VALUES ($1, 'Trigger test')", [accountId]);
      const { rows: [co] } = await client.query<{ id: string }>(
        "SELECT id FROM companies WHERE id = $1",
        [accountId],
      );
      expect(co?.id).toBe(accountId);

      // Only account_id set: company_id filled.
      await client.query(
        "INSERT INTO clients (id, account_id, name, email) VALUES ($1, $2, 'A', 'a@test.invalid')",
        [randomUUID(), accountId],
      );
      // Only company_id set: account_id filled.
      await client.query(
        "INSERT INTO clients (id, company_id, name, email) VALUES ($1, $2, 'B', 'b@test.invalid')",
        [randomUUID(), accountId],
      );
      const { rows: inserted } = await client.query<{ equal: boolean; both: boolean }>(
        `SELECT (account_id = company_id) AS equal, (account_id IS NOT NULL AND company_id IS NOT NULL) AS both
         FROM clients WHERE account_id = $1 OR company_id = $1`,
        [accountId],
      );
      expect(inserted).toHaveLength(2);
      for (const row of inserted) {
        expect(row.equal).toBe(true);
        expect(row.both).toBe(true);
      }

      // Update that clears one column is refilled.
      await client.query("UPDATE clients SET company_id = NULL WHERE account_id = $1 AND name = 'A'", [accountId]);
      const { rows: [refilled] } = await client.query<{ equal: boolean }>(
        "SELECT (account_id = company_id) AS equal FROM clients WHERE account_id = $1 AND name = 'A'",
        [accountId],
      );
      expect(refilled.equal).toBe(true);

      // Both set and different: rejected.
      await client.query("SAVEPOINT mismatch");
      await expect(
        client.query(
          "INSERT INTO clients (id, account_id, company_id, name, email) VALUES ($1, $2, $3, 'C', 'c@test.invalid')",
          [randomUUID(), accountId, randomUUID()],
        ),
      ).rejects.toThrow(/must equal account_id/);
      await client.query("ROLLBACK TO SAVEPOINT mismatch");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("(d) the rollback block removes only what 205 created", async () => {
    const source = readFileSync(MIGRATION, "utf8");
    const start = source.indexOf("-- BEGIN;\n");
    const end = source.indexOf("-- COMMIT;", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    // Strip the leading "-- " from each rollback line, leaving the SQL as it would be run.
    const rollbackSql = source
      .slice(start, end + "-- COMMIT;".length)
      .split("\n")
      .map((line) => line.replace(/^-- ?/, ""))
      .join("\n");

    const snapshotSql = `
      SELECT 'table ' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
      UNION ALL SELECT 'col ' || table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public'
      UNION ALL SELECT 'trg ' || tgrelid::regclass::text || ' ' || tgname FROM pg_trigger WHERE NOT tgisinternal
      UNION ALL SELECT 'fn ' || proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
      UNION ALL SELECT 'pol ' || tablename || ' ' || policyname FROM pg_policies
      UNION ALL SELECT 'con ' || conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace`;

    const client = await pool.connect();
    try {
      const before = new Set((await client.query<{ "?column?": string }>(snapshotSql)).rows.map((r) => Object.values(r)[0]));
      await client.query("BEGIN");
      // The rollback block contains its own BEGIN/COMMIT. Run its body without them, inside this rolled-back transaction.
      const body = rollbackSql.replace(/^BEGIN;\s*/m, "").replace(/COMMIT;\s*$/m, "");
      await client.query(body);
      const after = new Set((await client.query<{ "?column?": string }>(snapshotSql)).rows.map((r) => Object.values(r)[0]));
      await client.query("ROLLBACK");

      const removed = [...before].filter((x) => !after.has(x));
      const added = [...after].filter((x) => !before.has(x));
      expect(added).toEqual([]);
      expect(removed.length).toBeGreaterThan(0);
      // Only company-foundation objects may disappear.
      for (const item of removed) {
        const ok =
          item === "table companies" ||
          item === "fn sync_company_from_account" ||
          item === "fn sync_company_tenant_columns" ||
          item === "pol companies companies_select" ||
          item === "trg accounts trg_accounts_company_sync" ||
          item === "con companies_pkey" ||
          item.startsWith("col companies.") ||
          (item.startsWith("col ") && item.endsWith(".company_id")) ||
          (item.startsWith("trg ") && item.endsWith(" trg_company_tenant_sync")) ||
          (item.startsWith("con ") && item.includes("company_id_fkey"));
        expect(ok, `unexpected removal: ${item}`).toBe(true);
      }
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});
