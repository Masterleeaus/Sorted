/**
 * Integration: session-scoped loaders used by server pages return only the
 * caller's account when run as the restricted runtime role (ai_fsm_web).
 *
 * Requires:
 *   TEST_DATABASE_URL          admin URL, used to seed fixtures
 *   TEST_RUNTIME_DATABASE_URL  ai_fsm_web URL the loaders connect with
 * Skipped when either is unset.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../env", () => ({
  getEnv: () => ({ DATABASE_URL: process.env.TEST_RUNTIME_DATABASE_URL }),
}));
import { getPool } from "../db";
import { resolveJobPricingMode } from "../../lib/invoices/prefill-from-job";
import { loadVisitTimeline } from "../../lib/visits/load-visit-timeline";

const enabled = !!process.env.TEST_DATABASE_URL && !!process.env.TEST_RUNTIME_DATABASE_URL;

describe.skipIf(!enabled)("session-scoped page loaders under the runtime role", () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const clientA = randomUUID();
  const jobA = randomUUID();
  const visitA = randomUUID();
  const sessionA = { accountId: accountA, userId: userA, role: "owner" as const };
  const sessionB = { accountId: accountB, userId: userB, role: "owner" as const };

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Scope A'), ($2, 'Scope B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Scope A owner', 'x', 'owner'), ($4, $5, $6, 'Scope B owner', 'x', 'owner')`,
      [userA, accountA, `scope-a-${userA}@test.invalid`, userB, accountB, `scope-b-${userB}@test.invalid`],
    );
    await admin.query("INSERT INTO clients (id, account_id, name) VALUES ($1, $2, 'Scope client A')", [clientA, accountA]);
    await admin.query(
      `INSERT INTO jobs (id, account_id, client_id, title, created_by, pricing_mode)
       VALUES ($1, $2, $3, 'Scope job A', $4, 'flat_rate')`,
      [jobA, accountA, clientA, userA],
    );
    await admin.query(
      `INSERT INTO visits (id, account_id, job_id, scheduled_start, scheduled_end, visit_type)
       VALUES ($1, $2, $3, now(), now() + interval '1 hour', 'site_visit')`,
      [visitA, accountA, jobA],
    );
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
    await getPool().end();
  });

  it("reads the owning account's job pricing mode through the session", async () => {
    await expect(resolveJobPricingMode(sessionA, jobA)).resolves.toBe("flat_rate");
  });

  it("does not expose another account's job pricing mode", async () => {
    await expect(resolveJobPricingMode(sessionB, jobA)).resolves.not.toBe("flat_rate");
  });

  it("returns the owning account's visit timeline and nothing for another account", async () => {
    const own = await loadVisitTimeline(sessionA, visitA);
    expect(own.length).toBeGreaterThan(0);
    await expect(loadVisitTimeline(sessionB, visitA)).resolves.toEqual([]);
  });
});
