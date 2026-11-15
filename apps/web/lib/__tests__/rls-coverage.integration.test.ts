import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Live-database guard for issue #6. The text guard in scripts/check-rls-coverage.mjs
// reads migration files. This test reads the migrated database's catalog, so it
// also catches a table whose RLS state was changed outside the migrations.
//
// Needs TEST_DATABASE_URL (admin, migrated schema) and TEST_RUNTIME_DATABASE_URL
// (ai_fsm_web, provisioned by scripts/db-provision-runtime.sh).
const enabled = !!process.env.TEST_DATABASE_URL && !!process.env.TEST_RUNTIME_DATABASE_URL;
if (process.env.CI && !enabled) {
  throw new Error("RLS coverage integration requires TEST_DATABASE_URL and TEST_RUNTIME_DATABASE_URL");
}

describe.skipIf(!enabled)("account-scoped tables enforce RLS in the live schema", () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const runtime = new Pool({ connectionString: process.env.TEST_RUNTIME_DATABASE_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();

  // Every public table that has an account_id column.
  const ACCOUNT_TABLES_SQL = `
    SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           EXISTS (
             SELECT 1 FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = c.relname
               AND (coalesce(p.qual, '') || coalesce(p.with_check, ''))
                   ~* 'app\\.current_account_id|app_account_id'
           ) AS has_account_policy
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'account_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname`;

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'RLS cov A'), ($2, 'RLS cov B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO pricing_rule_snapshots (account_id, version, rules) VALUES ($1, 'cov-test', '{}'::jsonb)`,
      [accountB],
    );
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
    await runtime.end();
  });

  it("forces RLS and has an account policy on every account-scoped table", async () => {
    const { rows } = await admin.query<{ name: string; rls: boolean; forced: boolean; has_account_policy: boolean }>(
      ACCOUNT_TABLES_SQL,
    );
    expect(rows.length).toBeGreaterThan(0);
    const notForced = rows.filter((r) => !r.rls || !r.forced).map((r) => r.name);
    const noPolicy = rows.filter((r) => !r.has_account_policy).map((r) => r.name);
    expect(notForced).toEqual([]);
    expect(noPolicy).toEqual([]);
  });

  it("pricing snapshots are visible only inside their own account context", async () => {
    const client = await runtime.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_account_id', $1, true)", [accountA]);
      expect((await client.query("SELECT id FROM pricing_rule_snapshots WHERE account_id = $1", [accountB])).rows)
        .toEqual([]);
      await client.query("ROLLBACK");

      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_account_id', $1, true)", [accountB]);
      expect((await client.query("SELECT account_id FROM pricing_rule_snapshots")).rows)
        .toEqual([{ account_id: accountB }]);
      await client.query("ROLLBACK");

      await expect(runtime.query("SELECT id FROM pricing_rule_snapshots")).resolves.toMatchObject({ rows: [] });
    } finally {
      client.release();
    }
  });
});
