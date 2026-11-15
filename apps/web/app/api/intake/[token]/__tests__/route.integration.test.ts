/**
 * Real-database concurrency check for the intake claim (issue #19).
 *
 * Skip condition: TEST_DATABASE_URL absent. Requires a migrated database
 * (db/migrations applied). Run with:
 *   TEST_DATABASE_URL=postgresql://... pnpm --filter @ai-fsm/web exec vitest run \
 *     --config vitest.integration.config.ts "app/api/intake"
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("intake claim against Postgres (concurrency)", () => {
  let admin: Pool;
  let POST: typeof import("../route").POST;
  const accountId = randomUUID();

  beforeAll(async () => {
    // The route resolves its pool and env from process.env on first use.
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_SECRET ??= "integration-test-secret-at-least-32-chars-long";
    process.env.TRUSTED_PROXY_COUNT = "1";
    admin = new Pool({ connectionString: TEST_DB, max: 2 });
    await admin.query(`INSERT INTO accounts (id, name) VALUES ($1, 'intake-race-test')`, [accountId]);
    POST = (await import("../route")).POST;
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
    await admin.end();
  });

  async function seed() {
    const bookingId = randomUUID();
    const token = randomUUID();
    await admin.query(
      `INSERT INTO booking_requests (id, account_id, name, service_description)
       VALUES ($1, $2, 'Seed Lead', 'Seed description for the race test.')`,
      [bookingId, accountId]
    );
    await admin.query(
      `INSERT INTO intake_invites (account_id, booking_request_id, token, lead_name, lead_email)
       VALUES ($1, $2, $3, 'Seed Lead', 'seed@example.com')`,
      [accountId, bookingId, token]
    );
    return { bookingId, token };
  }

  function submit(token: string, name: string, ip: string) {
    const req = new NextRequest(`http://localhost:3000/api/intake/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({
        name,
        service_category: "general_repairs",
        service_description: "Door latch is loose and needs adjustment.",
        preferred_time_slot: "flexible",
        intake_metadata: {},
      }),
    });
    return POST(req, { params: Promise.resolve({ token }) });
  }

  it("six concurrent submissions on one valid token: exactly one commits", async () => {
    const { bookingId, token } = await seed();
    const names = ["A", "B", "C", "D", "E", "F"].map((l) => `Lead ${l}`);

    const responses = await Promise.all(
      names.map((name, i) => submit(token, name, `10.20.0.${i + 1}`))
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409, 409]);

    const { rows: booking } = await admin.query<{ name: string }>(
      `SELECT name FROM booking_requests WHERE id = $1`,
      [bookingId]
    );
    // The booking holds the winner's name, written once, and no other value.
    const winnerIndex = responses.findIndex((r) => r.status === 200);
    expect(booking[0].name).toBe(names[winnerIndex]);

    const { rows: used } = await admin.query<{ used_at: Date | null }>(
      `SELECT used_at FROM intake_invites WHERE token = $1`,
      [token]
    );
    expect(used[0].used_at).not.toBeNull();
  });

  it("an expired invite is rejected without a claim", async () => {
    const bookingId = randomUUID();
    const token = randomUUID();
    await admin.query(
      `INSERT INTO booking_requests (id, account_id, name, service_description)
       VALUES ($1, $2, 'Old Lead', 'Old description for the expiry test.')`,
      [bookingId, accountId]
    );
    await admin.query(
      `INSERT INTO intake_invites (account_id, booking_request_id, token, lead_name, lead_email, expires_at)
       VALUES ($1, $2, $3, 'Old Lead', 'old@example.com', now() - interval '1 hour')`,
      [accountId, bookingId, token]
    );
    const res = await submit(token, "Too Late", "10.30.0.1");
    expect(res.status).toBe(410);
    const { rows } = await admin.query<{ name: string }>(
      `SELECT name FROM booking_requests WHERE id = $1`,
      [bookingId]
    );
    expect(rows[0].name).toBe("Old Lead");
  });
});
