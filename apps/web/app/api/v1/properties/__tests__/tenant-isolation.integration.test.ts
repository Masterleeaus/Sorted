/**
 * Tenant isolation against a real database, as the restricted web runtime role.
 *
 * Runs the real route handlers and the real session helper (withDbSession), so
 * app.current_account_id is set from the session and RLS applies because the
 * connection role is ai_fsm_web (NOBYPASSRLS).
 *
 * Requires:
 *   TEST_RUNTIME_DATABASE_URL  connection string for ai_fsm_web (migrations + role applied)
 *   TEST_ADMIN_DATABASE_URL    owner/admin connection string used only to seed and clean up
 * Skipped when either is absent.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { NextRequest } from "next/server";

const RUNTIME_URL = process.env.TEST_RUNTIME_DATABASE_URL;
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL;
const RUN = !!RUNTIME_URL && !!ADMIN_URL;

// The active session is injected per request; the real middleware reads cookies.
const current: { session: Record<string, unknown> } = { session: {} };

vi.mock("@/lib/auth/middleware", () => ({
  withAuth: (handler: Function) => (request: NextRequest) => handler(request, current.session),
  withRole: (_roles: string[], handler: Function) => (request: NextRequest) =>
    handler(request, current.session),
}));

vi.mock("@/lib/db/audit", () => ({ appendAuditLog: vi.fn() }));

const ACCOUNT_A = randomUUID();
const ACCOUNT_B = randomUUID();
const PROPERTY_A = randomUUID();
const PROPERTY_B = randomUUID();
const USER_A = randomUUID();
const USER_B = randomUUID();

function sessionFor(accountId: string, userId: string) {
  return { userId, accountId, role: "owner", traceId: randomUUID() };
}

function req(path: string, init?: { method?: string; body?: unknown }): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/properties${path}`, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  });
}

describe.skipIf(!RUN)("tenant isolation: properties routes on the runtime role", () => {
  let admin: Client;
  let runtime: Client;
  let listRoute: typeof import("../route");
  let detailRoute: typeof import("../[id]/route");
  let notesRoute: typeof import("../[id]/notes/route");

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(
      `INSERT INTO accounts (id, name) VALUES ($1, 'Tenant A'), ($2, 'Tenant B')`,
      [ACCOUNT_A, ACCOUNT_B],
    );
    await admin.query(
      `INSERT INTO properties (id, account_id, address) VALUES ($1, $2, '1 A Street'), ($3, $4, '2 B Street')`,
      [PROPERTY_A, ACCOUNT_A, PROPERTY_B, ACCOUNT_B],
    );

    // Point the real pool at the runtime role before the helper is first used.
    process.env.DATABASE_URL = RUNTIME_URL;
    process.env.AUTH_SECRET ??= "x".repeat(32);
    listRoute = await import("../route");
    detailRoute = await import("../[id]/route");
    notesRoute = await import("../[id]/notes/route");

    runtime = new Client({ connectionString: RUNTIME_URL });
    await runtime.connect();
  });

  afterAll(async () => {
    await runtime?.end();
    await admin?.query(`DELETE FROM properties WHERE id = ANY($1::uuid[])`, [[PROPERTY_A, PROPERTY_B]]);
    await admin?.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[])`, [[ACCOUNT_A, ACCOUNT_B]]);
    await admin?.end();
  });

  it("the runtime role is not a superuser and does not bypass RLS", async () => {
    const { rows } = await runtime.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("without a session context the runtime role sees no properties (fails closed)", async () => {
    const { rows } = await runtime.query(
      `SELECT id FROM properties WHERE id = ANY($1::uuid[])`,
      [[PROPERTY_A, PROPERTY_B]],
    );
    expect(rows).toHaveLength(0);
  });

  it("list returns only the caller's properties", async () => {
    current.session = sessionFor(ACCOUNT_B, USER_B);
    const res = await listRoute.GET(req(""));
    expect(res.status).toBe(200);
    const ids = ((await res.json()).data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(PROPERTY_B);
    expect(ids).not.toContain(PROPERTY_A);
  });

  it("detail returns 404 for another account's property and 200 for its own", async () => {
    current.session = sessionFor(ACCOUNT_B, USER_B);
    const crossTenant = await detailRoute.GET(req(`/${PROPERTY_A}`));
    expect(crossTenant.status).toBe(404);

    current.session = sessionFor(ACCOUNT_A, USER_A);
    const own = await detailRoute.GET(req(`/${PROPERTY_A}`));
    expect(own.status).toBe(200);
    expect((await own.json()).data.id).toBe(PROPERTY_A);
  });

  it("notes list returns 404 across tenants", async () => {
    current.session = sessionFor(ACCOUNT_B, USER_B);
    const res = await notesRoute.GET(req(`/${PROPERTY_A}/notes`));
    expect(res.status).toBe(404);
  });

  it("PATCH from another account cannot change the property", async () => {
    current.session = sessionFor(ACCOUNT_B, USER_B);
    const res = await detailRoute.PATCH(req(`/${PROPERTY_A}`, { method: "PATCH", body: { name: "Hijacked" } }));
    expect(res.status).toBe(404);

    const { rows } = await admin.query(`SELECT name FROM properties WHERE id = $1`, [PROPERTY_A]);
    expect(rows[0].name).not.toBe("Hijacked");
  });
});
