/**
 * Integration: vehicle routes run inside an account-scoped DB session and never
 * read or change another account's vehicles.
 *
 * Calls the real handlers as account A against account B's vehicle. Account A
 * must get 404 and account B's row must be unchanged. Account A's own reads
 * must still return data, which proves the account context is set for the
 * restricted runtime role.
 *
 * Requires:
 *   TEST_DATABASE_URL       admin URL, used to seed fixtures
 *   TEST_WEB_DATABASE_URL   URL the handlers connect with (defaults to TEST_DATABASE_URL).
 *                           Set to the ai_fsm_web URL to exercise RLS.
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const WEB_URL = process.env.TEST_WEB_DATABASE_URL ?? ADMIN_URL;

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

import { GET as listVehicles } from "@/app/api/v1/vehicles/route";
import { PATCH as patchVehicle } from "@/app/api/v1/vehicles/[id]/route";

const enabled = !!ADMIN_URL;

describe.skipIf(!enabled)("vehicle routes: tenant isolation (account A session, account B vehicle)", () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const vehicleA = randomUUID();
  const vehicleB = randomUUID();
  const nicknameB = `Isolation van B ${randomUUID()}`;

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Vehicle Iso A'), ($2, 'Vehicle Iso B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', 'x', 'owner'), ($4, $5, $6, 'Owner B', 'x', 'owner')`,
      [ownerA, accountA, `veh-a-${ownerA}@test.invalid`, ownerB, accountB, `veh-b-${ownerB}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO vehicles (id, account_id, nickname) VALUES ($1, $2, 'Isolation van A'), ($3, $4, $5)`,
      [vehicleA, accountA, vehicleB, accountB, nicknameB],
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

  it("GET lists only account A's vehicles", async () => {
    const res = await listVehicles(request("/api/v1/vehicles"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    const ids = body.data.map((v) => v.id);
    expect(ids).toContain(vehicleA);
    expect(ids).not.toContain(vehicleB);
  });

  it("PATCH on account B's vehicle returns 404 and leaves the row unchanged", async () => {
    const res = await patchVehicle(
      request(`/api/v1/vehicles/${vehicleB}`, { method: "PATCH", body: { nickname: "Hijacked" } }),
    );
    expect(res.status).toBe(404);

    const row = await admin.query<{ nickname: string }>("SELECT nickname FROM vehicles WHERE id = $1", [vehicleB]);
    expect(row.rows[0]?.nickname).toBe(nicknameB);
  });

  it("PATCH on account A's own vehicle succeeds under the runtime role", async () => {
    const res = await patchVehicle(
      request(`/api/v1/vehicles/${vehicleA}`, { method: "PATCH", body: { nickname: "Own van A" } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; nickname: string } };
    expect(body.data).toMatchObject({ id: vehicleA, nickname: "Own van A" });
  });

  it("PATCH is_default on account A never clears account B's default", async () => {
    await admin.query("UPDATE vehicles SET is_default = true WHERE id = $1", [vehicleB]);
    const res = await patchVehicle(
      request(`/api/v1/vehicles/${vehicleA}`, { method: "PATCH", body: { is_default: true } }),
    );
    expect(res.status).toBe(200);
    const row = await admin.query<{ is_default: boolean }>("SELECT is_default FROM vehicles WHERE id = $1", [vehicleB]);
    expect(row.rows[0]?.is_default).toBe(true);
  });
});
