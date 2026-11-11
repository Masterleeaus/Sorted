/**
 * Integration: vehicle-session activity and suggestion routes run inside an
 * account-scoped DB session and never read or change another account's rows.
 *
 * Requires:
 *   TEST_DATABASE_URL       admin URL, used to seed fixtures
 *   TEST_WEB_DATABASE_URL   URL the handlers connect with (defaults to TEST_DATABASE_URL).
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ADMIN_URL = process.env.TEST_DATABASE_URL;

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

import { POST as addActivity, DELETE as removeActivity } from "@/app/api/v1/sessions/[id]/activities/route";

const enabled = !!ADMIN_URL;
const DATE = "2026-05-04";

describe.skipIf(!enabled)("sessions activity routes: tenant isolation", () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const sessionA = randomUUID();
  const sessionB = randomUUID();
  const activityB = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  const jobA = randomUUID();
  const jobB = randomUUID();
  const titleB = `Isolation job B ${randomUUID()}`;

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Session Iso A'), ($2, 'Session Iso B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', 'x', 'owner'), ($4, $5, $6, 'Owner B', 'x', 'owner')`,
      [ownerA, accountA, `sess-a-${ownerA}@test.invalid`, ownerB, accountB, `sess-b-${ownerB}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO vehicle_sessions (id, account_id, session_date, start_odometer) VALUES ($1, $2, $3, 100), ($4, $5, $3, 200)`,
      [sessionA, accountA, DATE, sessionB, accountB],
    );
    await admin.query(
      `INSERT INTO vehicle_session_activities (id, session_id, entity_type, label) VALUES ($1, $2, 'other', 'B activity')`,
      [activityB, sessionB],
    );
    await admin.query(
      `INSERT INTO clients (id, account_id, name) VALUES ($1, $2, 'Client A'), ($3, $4, 'Client B')`,
      [clientA, accountA, clientB, accountB],
    );
    await admin.query(
      `INSERT INTO jobs (id, account_id, client_id, title, status, created_by)
       VALUES ($1, $2, $3, 'Job A', 'scheduled', $4), ($5, $6, $7, $8, 'scheduled', $9)`,
      [jobA, accountA, clientA, ownerA, jobB, accountB, clientB, titleB, ownerB],
    );
    await admin.query(
      `INSERT INTO visits (account_id, job_id, scheduled_start, scheduled_end, visit_type)
       VALUES ($1, $2, $3::timestamptz, $3::timestamptz + interval '1 hour', 'site_visit'),
              ($4, $5, $3::timestamptz, $3::timestamptz + interval '1 hour', 'site_visit')`,
      [accountA, jobA, `${DATE}T09:00:00Z`, accountB, jobB],
    );
    session.current = { userId: ownerA, accountId: accountA, role: "owner" };
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
  });

  const request = (path: string, init?: { method?: string; body?: unknown }) =>
    new NextRequest(`http://localhost${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });

  it("POST activity to account B's session returns 404 and inserts nothing", async () => {
    const res = await addActivity(
      request(`/api/v1/sessions/${sessionB}/activities`, { method: "POST", body: { entity_type: "other", label: "Injected" } }),
    );
    expect(res.status).toBe(404);
    const count = await admin.query("SELECT count(*)::int AS n FROM vehicle_session_activities WHERE session_id = $1", [sessionB]);
    expect(count.rows[0]?.n).toBe(1);
  });

  it("POST activity to account A's own session succeeds under the runtime role", async () => {
    const res = await addActivity(
      request(`/api/v1/sessions/${sessionA}/activities`, { method: "POST", body: { entity_type: "other", label: "Own" } }),
    );
    expect(res.status).toBe(201);
  });

  it("DELETE account B's activity returns 404 and keeps the row", async () => {
    const res = await removeActivity(
      request(`/api/v1/sessions/${sessionB}/activities?activity_id=${activityB}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
    const row = await admin.query("SELECT id FROM vehicle_session_activities WHERE id = $1", [activityB]);
    expect(row.rowCount).toBe(1);
  });
});
