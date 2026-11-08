/**
 * Unit tests for the portal invoice route. The pool is a recording fake. The
 * token lookups are the only reads before account context. Everything after
 * them must run in the invoice's account context, and the POST transaction must
 * be closed on every return path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INVOICE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const state = vi.hoisted(() => ({
  log: [] as { sql: string; params?: unknown[] }[],
  invoice: null as null | Record<string, unknown>,
  pendingAmount: null as null | number,
  squareEnabled: true,
  open: false,
}));

const fakeClient = vi.hoisted(() => ({
  query: async (sql: string, params?: unknown[]) => {
    state.log.push({ sql, params });
    if (sql === "BEGIN") state.open = true;
    if (sql === "COMMIT" || sql === "ROLLBACK") state.open = false;
    if (sql.includes("FROM payments") && sql.startsWith("SELECT amount_cents")) {
      return { rows: state.pendingAmount === null ? [] : [{ amount_cents: state.pendingAmount }] };
    }
    if (sql.includes("FROM invoice_line_items")) return { rows: [{ id: "li-1", description: "Caulk" }] };
    return { rows: [] };
  },
  release: () => {},
}));

vi.mock("@/lib/db", () => ({
  getPool: () => ({ connect: async () => fakeClient }),
  query: vi.fn(),
  queryOne: async (sql: string, params?: unknown[]) => {
    state.log.push({ sql, params });
    return state.invoice;
  },
}));

vi.mock("@/lib/portal/session", () => ({
  isPortalPreview: async () => false,
  PREVIEW_READ_ONLY_MESSAGE: "Admin preview is read-only",
}));

vi.mock("@/lib/integrations/square-payments", () => ({
  loadSquareSettings: async () =>
    state.squareEnabled
      ? { enabled: true, secrets: { accessToken: "tok" }, config: { locationId: "L1" } }
      : null,
  createSquarePaymentLink: async () => ({
    orderId: "o1",
    paymentLinkId: "pl1",
    url: "https://square.example/new",
  }),
}));

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { GET, POST } from "../route";

const ctx = { params: Promise.resolve({ token: "share-tok" }) };

function baseInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE,
    account_id: ACCOUNT,
    client_id: CLIENT,
    job_id: null,
    created_by: USER,
    status: "sent",
    invoice_number: "INV-100",
    subtotal_cents: 10000,
    tax_cents: 0,
    total_cents: 10000,
    paid_cents: 0,
    deposit_cents: 0,
    deposit_type: "none",
    deposit_percentage: null,
    deposit_fixed_cents: null,
    notes: null,
    due_date: null,
    sent_at: null,
    paid_at: null,
    square_payment_link_url: null,
    client_name: "Pat",
    property_address: null,
    property_city: null,
    property_state: null,
    property_zip: null,
    account_name: "Dovetails",
    account_settings: {},
    ...overrides,
  };
}

beforeEach(() => {
  state.log = [];
  state.invoice = baseInvoice();
  state.pendingAmount = null;
  state.squareEnabled = true;
  state.open = false;
});

describe("GET /api/portal/invoices/[token]", () => {
  it("reads line items inside the invoice account context and omits account_id from the response", async () => {
    const res = await GET(new NextRequest("http://localhost:3000/api/portal/invoices/t"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoice).not.toHaveProperty("account_id");
    expect(body.invoice.invoice_number).toBe("INV-100");
    expect(body.lineItems).toEqual([{ id: "li-1", description: "Caulk" }]);

    const sqls = state.log.map((c) => c.sql);
    const ctxIdx = sqls.findIndex((s) => s.includes("set_config('app.current_account_id'"));
    const liIdx = sqls.findIndex((s) => s.includes("FROM invoice_line_items"));
    expect(ctxIdx).toBeGreaterThan(-1);
    expect(liIdx).toBeGreaterThan(ctxIdx);
    expect(state.log[liIdx].sql).toContain("account_id = $2");
    expect(state.log[liIdx].params).toEqual([INVOICE, ACCOUNT]);
  });

  it("returns 404 for an unknown share token without reading line items", async () => {
    state.invoice = null;
    const res = await GET(new NextRequest("http://localhost:3000/api/portal/invoices/t"), ctx);
    expect(res.status).toBe(404);
    expect(state.log.some((c) => c.sql.includes("FROM invoice_line_items"))).toBe(false);
  });
});

describe("POST /api/portal/invoices/[token]", () => {
  const req = () => new NextRequest("http://localhost:3000/api/portal/invoices/t", { method: "POST" });

  it("returns an existing matching pending link inside account context and closes the transaction", async () => {
    state.invoice = baseInvoice({ square_payment_link_url: "https://square.example/old" });
    state.pendingAmount = 10000;
    const res = await POST(req(), ctx);
    expect(await res.json()).toEqual({ url: "https://square.example/old" });
    expect(state.open).toBe(false);

    const sqls = state.log.map((c) => c.sql);
    const ctxIdx = sqls.findIndex((s) => s.includes("set_config('app.current_account_id'"));
    const pendingIdx = sqls.findIndex((s) => s.startsWith("SELECT amount_cents FROM payments"));
    expect(state.log[ctxIdx].params?.[0]).toBe(ACCOUNT);
    expect(pendingIdx).toBeGreaterThan(ctxIdx);
    expect(state.log[pendingIdx].sql).toContain("account_id = $2");
  });

  it("returns 422 when Square is not enabled and still closes the transaction", async () => {
    state.squareEnabled = false;
    const res = await POST(req(), ctx);
    expect(res.status).toBe(422);
    expect(state.open).toBe(false);
  });

  it("creates a new link, updates and inserts payment inside the account context", async () => {
    const res = await POST(req(), ctx);
    expect(await res.json()).toEqual({ url: "https://square.example/new" });
    expect(state.open).toBe(false);
    const sqls = state.log.map((c) => c.sql);
    const ctxIdx = sqls.findIndex((s) => s.includes("set_config('app.current_account_id'"));
    const insertIdx = sqls.findIndex((s) => s.startsWith("INSERT INTO payments"));
    expect(insertIdx).toBeGreaterThan(ctxIdx);
  });
});
