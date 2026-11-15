/**
 * Integration: API routes never read or change another account's records.
 *
 * Calls the real route handlers with a session for account A and records that
 * belong to account B. Every case must return 404 and leave account B's rows
 * unchanged. Account scoping in the SQL is the boundary the app relies on today;
 * RLS is the second layer once the web tier runs as ai_fsm_web.
 *
 * Requires:
 *   TEST_DATABASE_URL       admin URL, used to seed fixtures
 *   TEST_WEB_DATABASE_URL   URL the handlers connect with (defaults to TEST_DATABASE_URL).
 *                           Set it to the ai_fsm_web URL to test the restricted role. Some
 *                           GET handlers still use raw queries without account context, so
 *                           own-account reads fail under that role until the web cutover gate
 *                           in docs/working/rls-web-tier-flip.md clears.
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

import { GET as getClient, PATCH as patchClient } from "@/app/api/v1/clients/[id]/route";
import { GET as getProperty } from "@/app/api/v1/properties/[id]/route";

const enabled = !!ADMIN_URL;

describe.skipIf(!enabled)("API tenant isolation (account A session, account B records)", () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  const propertyB = randomUUID();
  const nameB = `Isolation B ${randomUUID()}`;

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Isolation A'), ($2, 'Isolation B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', 'x', 'owner'), ($4, $5, $6, 'Owner B', 'x', 'owner')`,
      [ownerA, accountA, `iso-a-${ownerA}@test.invalid`, ownerB, accountB, `iso-b-${ownerB}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO clients (id, account_id, name) VALUES ($1, $2, 'Isolation client A'), ($3, $4, $5)`,
      [clientA, accountA, clientB, accountB, nameB],
    );
    await admin.query(
      "INSERT INTO properties (id, account_id, client_id, address) VALUES ($1, $2, $3, '1 Isolation Way')",
      [propertyB, accountB, clientB],
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

  it("account A reads its own client (control)", async () => {
    const res = await getClient(request(`/api/v1/clients/${clientA}`), { params: Promise.resolve({ id: clientA }) } as never);
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(clientA);
  });

  it("account A cannot read account B's client", async () => {
    const res = await getClient(request(`/api/v1/clients/${clientB}`), { params: Promise.resolve({ id: clientB }) } as never);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("account A cannot read account B's property", async () => {
    const res = await getProperty(request(`/api/v1/properties/${propertyB}`), { params: Promise.resolve({ id: propertyB }) } as never);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("account A cannot change account B's client", async () => {
    const res = await patchClient(
      request(`/api/v1/clients/${clientB}`, { method: "PATCH", body: { name: "Hijacked" } }),
      { params: Promise.resolve({ id: clientB }) } as never,
    );
    expect(res.status).toBe(404);
    const { rows } = await admin.query("SELECT name, account_id FROM clients WHERE id = $1", [clientB]);
    expect(rows).toEqual([{ name: nameB, account_id: accountB }]);
  });
});
