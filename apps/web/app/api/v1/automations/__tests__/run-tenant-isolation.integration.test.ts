/**
 * Integration: POST /api/v1/automations/[id]/run looks up the automation inside
 * an account-scoped DB session. Account A gets 404 for account B's automation.
 * Account A's own automation is found under the runtime role (a disabled one
 * returns 422, which proves the row was read).
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

import { POST as runAutomation } from "@/app/api/v1/automations/[id]/run/route";

const enabled = !!ADMIN_URL;

describe.skipIf(!enabled)("automation run route: tenant isolation", () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const autoB = randomUUID();
  const autoADisabled = randomUUID();

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Auto Iso A'), ($2, 'Auto Iso B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', 'x', 'owner'), ($4, $5, $6, 'Owner B', 'x', 'owner')`,
      [ownerA, accountA, `auto-a-${ownerA}@test.invalid`, ownerB, accountB, `auto-b-${ownerB}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO automations (id, account_id, type, enabled, next_run_at)
       VALUES ($1, $2, 'stale_job_nudge', true, now()), ($3, $4, 'stale_job_nudge', false, now())`,
      [autoB, accountB, autoADisabled, accountA],
    );
    session.current = { userId: ownerA, accountId: accountA, role: "owner" };
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
  });

  const request = (id: string) =>
    new NextRequest(`http://localhost/api/v1/automations/${id}/run`, { method: "POST" });

  it("POST run on account B's automation returns 404", async () => {
    const res = await runAutomation(request(autoB));
    expect(res.status).toBe(404);
  });

  it("POST run on account A's own disabled automation is found under the runtime role", async () => {
    const res = await runAutomation(request(autoADisabled));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Automation is disabled");
  });
});
