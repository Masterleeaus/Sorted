/**
 * Integration: POST /api/v1/users/[id]/password runs in an account-scoped DB
 * session. An owner of account A cannot change a password for a user in
 * account B, and account B's hash is unchanged. Account A can still change its
 * own password under the runtime role.
 *
 * Requires:
 *   TEST_DATABASE_URL       admin URL, used to seed fixtures
 *   TEST_WEB_DATABASE_URL   URL the handlers connect with (defaults to TEST_DATABASE_URL).
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { hash } from "bcryptjs";
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

import { POST as changePassword } from "@/app/api/v1/users/[id]/password/route";

const enabled = !!ADMIN_URL;

describe.skipIf(!enabled)("users password route: tenant isolation", () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const oldHashB = "$2a$12$unchangedhashforisolationtest0000000000000000000000";

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Pw Iso A'), ($2, 'Pw Iso B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', $4, 'owner'), ($5, $6, $7, 'Owner B', $8, 'owner')`,
      [
        ownerA, accountA, `pw-a-${ownerA}@test.invalid`, await hash("current-password-a", 4),
        ownerB, accountB, `pw-b-${ownerB}@test.invalid`, oldHashB,
      ],
    );
    session.current = { userId: ownerA, accountId: accountA, role: "owner" };
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
  });

  const request = (id: string, body: unknown) =>
    new NextRequest(`http://localhost/api/v1/users/${id}/password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("owner of account A gets 404 for account B's user and B's hash is unchanged", async () => {
    const res = await changePassword(request(ownerB, { new_password: "hijacked-password" }));
    expect(res.status).toBe(404);
    const row = await admin.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [ownerB]);
    expect(row.rows[0]?.password_hash).toBe(oldHashB);
  });

  it("account A can change its own password under the runtime role", async () => {
    const res = await changePassword(
      request(ownerA, { current_password: "current-password-a", new_password: "new-password-a-123" }),
    );
    expect(res.status).toBe(200);
    const row = await admin.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [ownerA]);
    expect(row.rows[0]?.password_hash).not.toBe("");
    expect(row.rows[0]?.password_hash).not.toContain("current-password-a");
  });
});
