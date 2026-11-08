/**
 * Unit tests for the portal estimate route. The token lookups are the only reads
 * before account context. The respond UPDATE must run after the context is set,
 * with an account predicate, and the transaction must close on success.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ESTIMATE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OWNER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const state = vi.hoisted(() => ({
  log: [] as { sql: string; params?: unknown[] }[],
  estimate: null as null | Record<string, unknown>,
  open: false,
}));

const fakeClient = vi.hoisted(() => ({
  query: async (sql: string, params?: unknown[]) => {
    state.log.push({ sql, params });
    if (sql === "BEGIN") state.open = true;
    if (sql === "COMMIT" || sql === "ROLLBACK") state.open = false;
    if (sql.includes("FROM estimate_line_items")) return { rows: [{ id: "li-1" }] };
    return { rows: [] };
  },
  release: () => {},
}));

vi.mock("@/lib/db", () => ({
  getPool: () => ({ connect: async () => fakeClient }),
  query: vi.fn(),
  queryOne: async (sql: string, params?: unknown[]) => {
    state.log.push({ sql, params });
    return state.estimate;
  },
}));

vi.mock("@/lib/portal/session", () => ({
  isPortalPreview: async () => false,
  PREVIEW_READ_ONLY_MESSAGE: "Admin preview is read-only",
}));
vi.mock("@/lib/estimates/create-job-db", () => ({
  createJobFromEstimate: vi.fn(async () => undefined),
  getAccountOwnerUserId: vi.fn(async () => OWNER),
}));
vi.mock("@/lib/estimates/approve", () => ({ createApprovalArtifacts: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { GET, POST } from "../route";

const ctx = { params: Promise.resolve({ token: "share-tok" }) };

beforeEach(() => {
  state.log = [];
  state.open = false;
  state.estimate = {
    id: ESTIMATE,
    account_id: ACCOUNT,
    client_id: CLIENT,
    status: "sent",
    subtotal_cents: 5000,
    tax_cents: 0,
    total_cents: 5000,
    deposit_cents: null,
    notes: null,
    expires_at: null,
    sent_at: null,
    responded_at: null,
    client_approved_name: null,
    client_name: "Pat",
    property_address: null,
    property_city: null,
    property_state: null,
    property_zip: null,
    account_name: "Dovetails",
  };
});

describe("GET /api/portal/estimates/[token]", () => {
  it("reads line items inside the estimate's account context and omits account_id", async () => {
    const res = await GET(new NextRequest("http://localhost:3000/api/portal/estimates/t"), ctx);
    const body = await res.json();
    expect(body.estimate).not.toHaveProperty("account_id");
    expect(body.lineItems).toEqual([{ id: "li-1" }]);
    const sqls = state.log.map((c) => c.sql);
    const ctxIdx = sqls.findIndex((s) => s.includes("set_config('app.current_account_id'"));
    const liIdx = sqls.findIndex((s) => s.includes("FROM estimate_line_items"));
    expect(liIdx).toBeGreaterThan(ctxIdx);
    expect(state.log[liIdx].sql).toContain("e.account_id = $2");
    expect(state.log[liIdx].params).toEqual([ESTIMATE, ACCOUNT]);
  });
});

describe("POST /api/portal/estimates/[token]", () => {
  const req = (body: unknown) =>
    new NextRequest("http://localhost:3000/api/portal/estimates/t", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("sets account context before the respond UPDATE, with an account predicate, then commits", async () => {
    const res = await POST(req({ action: "approve", name: "Pat Portal" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "approved" });
    expect(state.open).toBe(false);

    const sqls = state.log.map((c) => c.sql);
    const ctxIdx = sqls.findIndex((s) => s.includes("set_config('app.current_account_id'"));
    const updIdx = sqls.findIndex((s) => s.startsWith("UPDATE estimates"));
    expect(ctxIdx).toBeGreaterThan(-1);
    expect(updIdx).toBeGreaterThan(ctxIdx);
    expect(state.log[ctxIdx].params?.[0]).toBe(ACCOUNT);
    expect(sqls[updIdx]).toContain("account_id = $5");
    expect(state.log[updIdx].params?.[4]).toBe(ACCOUNT);
  });

  it("returns 404 for an unknown token and writes nothing", async () => {
    state.estimate = null;
    const res = await POST(req({ action: "decline" }), ctx);
    expect(res.status).toBe(404);
    expect(state.log.some((c) => c.sql.startsWith("UPDATE"))).toBe(false);
  });
});
