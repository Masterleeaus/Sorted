/**
 * Integration: change-order routes run inside an account-scoped DB session.
 * Account A cannot create a change order on account B's estimate, list, read,
 * or change account B's change order. Account A's own writes still succeed
 * under the runtime role.
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

import { GET as listChangeOrders, POST as createChangeOrder } from "@/app/api/v1/change-orders/route";
import { GET as getChangeOrder, PATCH as patchChangeOrder } from "@/app/api/v1/change-orders/[id]/route";

const enabled = !!ADMIN_URL;

describe.skipIf(!enabled)("change-order routes: tenant isolation", () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  const estimateA = randomUUID();
  const estimateB = randomUUID();
  const coB = randomUUID();
  const titleB = `Isolation CO B ${randomUUID()}`;

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'CO Iso A'), ($2, 'CO Iso B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', 'x', 'owner'), ($4, $5, $6, 'Owner B', 'x', 'owner')`,
      [ownerA, accountA, `co-a-${ownerA}@test.invalid`, ownerB, accountB, `co-b-${ownerB}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO clients (id, account_id, name) VALUES ($1, $2, 'CO client A'), ($3, $4, 'CO client B')`,
      [clientA, accountA, clientB, accountB],
    );
    await admin.query(
      `INSERT INTO estimates (id, account_id, client_id, status, created_by)
       VALUES ($1, $2, $3, 'approved', $4), ($5, $6, $7, 'approved', $8)`,
      [estimateA, accountA, clientA, ownerA, estimateB, accountB, clientB, ownerB],
    );
    await admin.query(
      `INSERT INTO change_orders (id, estimate_id, account_id, title, status, created_by)
       VALUES ($1, $2, $3, $4, 'draft', $5)`,
      [coB, estimateB, accountB, titleB, ownerB],
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

  const lineItems = [{ description: "Trim", quantity: 2, unit_price_cents: 1000 }];

  it("POST against account B's estimate returns 404 and creates nothing", async () => {
    const res = await createChangeOrder(
      request("/api/v1/change-orders", {
        method: "POST",
        body: { estimate_id: estimateB, title: "Injected", line_items: lineItems },
      }),
    );
    expect(res.status).toBe(404);
    const count = await admin.query("SELECT count(*)::int AS n FROM change_orders WHERE estimate_id = $1", [estimateB]);
    expect(count.rows[0]?.n).toBe(1);
  });

  it("POST against account A's own approved estimate succeeds under the runtime role", async () => {
    const res = await createChangeOrder(
      request("/api/v1/change-orders", {
        method: "POST",
        body: { estimate_id: estimateA, title: "Own CO", line_items: lineItems },
      }),
    );
    expect(res.status).toBe(201);
  });

  it("GET list returns only account A's change orders", async () => {
    const res = await listChangeOrders(request("/api/v1/change-orders"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; estimate_id: string }[] };
    expect(body.data.some((c) => c.estimate_id === estimateB)).toBe(false);
    expect(body.data.some((c) => c.estimate_id === estimateA)).toBe(true);
  });

  it("GET by id for account B's change order returns 404", async () => {
    const res = await getChangeOrder(request(`/api/v1/change-orders/${coB}`));
    expect(res.status).toBe(404);
  });

  it("PATCH title on account B's change order returns 404 and leaves it unchanged", async () => {
    const res = await patchChangeOrder(
      request(`/api/v1/change-orders?id=${coB}`, { method: "PATCH", body: { title: "Hijacked" } }),
    );
    expect(res.status).toBe(404);
    const row = await admin.query<{ title: string }>("SELECT title FROM change_orders WHERE id = $1", [coB]);
    expect(row.rows[0]?.title).toBe(titleB);
  });

  it("action=send on account B's change order returns 404 and leaves status draft", async () => {
    const res = await patchChangeOrder(
      request(`/api/v1/change-orders?id=${coB}`, { method: "PATCH", body: { action: "send" } }),
    );
    expect(res.status).toBe(404);
    const row = await admin.query<{ status: string }>("SELECT status FROM change_orders WHERE id = $1", [coB]);
    expect(row.rows[0]?.status).toBe("draft");
  });
});
