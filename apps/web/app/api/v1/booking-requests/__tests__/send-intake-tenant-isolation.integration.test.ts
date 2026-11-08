/**
 * Integration: POST /api/v1/booking-requests/[id]/send-intake runs its queries
 * inside an account-scoped DB session. Account A gets 404 for account B's
 * booking request and no invite is created for it. For account A's own booking
 * request, the invite row is written under the runtime role.
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

import { POST as sendIntake } from "@/app/api/v1/booking-requests/[id]/send-intake/route";

const enabled = !!ADMIN_URL;

describe.skipIf(!enabled)("send-intake route: tenant isolation", () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const brA = randomUUID();
  const brB = randomUUID();

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Intake Send A'), ($2, 'Intake Send B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', 'x', 'owner'), ($4, $5, $6, 'Owner B', 'x', 'owner')`,
      [ownerA, accountA, `isend-a-${ownerA}@test.invalid`, ownerB, accountB, `isend-b-${ownerB}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO booking_requests (id, account_id, name, email, service_description, routing_path, preferred_contact, sms_consent, status)
       VALUES ($1, $2, 'Lead A', 'lead-a@test.invalid', 'Fix gate', 'site_visit', 'email', false, 'pending'),
              ($3, $4, 'Lead B', 'lead-b@test.invalid', 'Fix fence', 'site_visit', 'email', false, 'pending')`,
      [brA, accountA, brB, accountB],
    );
    session.current = { userId: ownerA, accountId: accountA, role: "owner" };
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
  });

  const request = (id: string) =>
    new NextRequest(`http://localhost/api/v1/booking-requests/${id}/send-intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

  it("POST on account B's booking request returns 404 and creates no invite", async () => {
    const res = await sendIntake(request(brB));
    expect(res.status).toBe(404);
    const invites = await admin.query("SELECT count(*)::int AS n FROM intake_invites WHERE booking_request_id = $1", [brB]);
    expect(invites.rows[0]?.n).toBe(0);
  });

  it("POST on account A's own booking request writes the invite under the runtime role", async () => {
    const res = await sendIntake(request(brA));
    expect(res.status).not.toBe(404);
    const invites = await admin.query(
      "SELECT account_id FROM intake_invites WHERE booking_request_id = $1",
      [brA],
    );
    expect(invites.rowCount).toBeGreaterThan(0);
    expect(invites.rows[0]?.account_id).toBe(accountA);
  });
});
