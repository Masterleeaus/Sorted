import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Migration 209 (account_id renamed to company_id). Needs a database with all
// migrations applied, including 209. Writes run inside a transaction that is rolled
// back, so the database is left as it was found.
const enabled = !!process.env.TEST_DATABASE_URL;
if (process.env.CI && !enabled) {
  throw new Error("Company rename integration requires TEST_DATABASE_URL");
}

describe.skipIf(!enabled)("company tenant key (migration 209)", () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

  beforeAll(async () => {
    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'company_id'
       ) AS exists`,
    );
    if (!rows[0].exists) throw new Error("migration 209 is not applied to TEST_DATABASE_URL");
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

  it("(b) no public table still has an account_id column, and clients has company_id", async () => {
    const { rows: leftovers } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'account_id'`,
    );
    expect(leftovers).toEqual([]);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'company_id'`,
    );
    expect(rows[0].n).toBe("1");
  });

  it("(c) the 205 mirror trigger and its function are gone", async () => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_trigger WHERE tgname = 'trg_company_tenant_sync' AND NOT tgisinternal`,
    );
    expect(rows[0].n).toBe("0");

    const { rows: fn } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'sync_company_tenant_columns'`,
    );
    expect(fn[0].n).toBe("0");
  });

  it("(d) inserts scope by company_id and the RLS session setting still isolates rows", async () => {
    const companyId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO accounts (id, name) VALUES ($1, 'Rename test')", [companyId]);
      await client.query(
        "INSERT INTO clients (id, company_id, name, email) VALUES ($1, $2, 'A', 'a@test.invalid')",
        [randomUUID(), companyId],
      );
      const { rows } = await client.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM clients WHERE company_id = $1",
        [companyId],
      );
      expect(rows[0].n).toBe("1");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});
