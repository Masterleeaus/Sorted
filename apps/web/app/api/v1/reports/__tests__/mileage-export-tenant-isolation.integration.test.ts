/**
 * Integration: GET /api/v1/reports/mileage-export runs in an account-scoped DB
 * session. An owner of account A gets only account A's vehicle sessions in the
 * CSV, and account B's session never appears.
 *
 * Requires:
 *   TEST_DATABASE_URL       admin URL, used to seed fixtures
 *   TEST_WEB_DATABASE_URL   URL the handler connects with (defaults to TEST_DATABASE_URL).
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const DATE = "2026-05-04";

const session = vi.hoisted(() => ({
  current: null as null | { userId: string; accountId: string; role: "owner" | "admin" | "tech" },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ DATABASE_URL: process.env.TEST_WEB_DATABASE_URL ?? process.env.TEST_DATABASE_URL }),
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSession: async () => session.current,
}));

import { GET as mileageExport } from "@/app/api/v1/reports/mileage-export/route";

const enabled = !!ADMIN_URL;

describe.skipIf(!enabled)("mileage export: tenant isolation", () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const sessionA = randomUUID();
  const sessionB = randomUUID();

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Mileage Iso A'), ($2, 'Mileage Iso B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', 'x', 'owner'), ($4, $5, $6, 'Owner B', 'x', 'owner')`,
      [ownerA, accountA, `mil-a-${ownerA}@test.invalid`, ownerB, accountB, `mil-b-${ownerB}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO vehicle_sessions (id, account_id, session_date, start_odometer, end_odometer)
       VALUES ($1, $2, $3, 1000, 1010), ($4, $5, $3, 2000, 2050)`,
      [sessionA, accountA, DATE, sessionB, accountB],
    );
    session.current = { userId: ownerA, accountId: accountA, role: "owner" };
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
  });

  it("CSV contains account A's session and not account B's", async () => {
    const req = new NextRequest(`http://localhost/api/v1/reports/mileage-export?from=${DATE}&to=${DATE}`);
    const res = await mileageExport(req);
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain(sessionA);
    expect(csv).not.toContain(sessionB);
  });
});
