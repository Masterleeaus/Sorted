import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks: DB pool, crypto, the Square signature verifier, and side effects.
// ---------------------------------------------------------------------------
const mockPoolQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockPool = {
  query: (...a: unknown[]) => mockPoolQuery(...a),
  connect: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  getPool: () => mockPool,
}));

vi.mock("@/lib/crypto", () => ({
  decryptJson: vi.fn(() => ({ accessToken: "tok", webhookSignatureKey: "whk" })),
}));

const mockVerify = vi.fn();
vi.mock("@/lib/integrations/square-payments", () => ({
  verifySquareWebhook: (...a: unknown[]) => mockVerify(...a),
}));

vi.mock("@/lib/attention", () => ({ emitInvoicePaymentAttention: vi.fn() }));
vi.mock("@/lib/jobs/close-if-paid", () => ({ closeJobIfFullyPaid: vi.fn() }));

import { POST } from "../route";

const ACCOUNT = "00000000-0000-0000-0000-0000000000aa";
const INVOICE = "00000000-0000-0000-0000-0000000000bb";
const LINK_ROW_1 = "00000000-0000-0000-0000-000000000101";
const LINK_ROW_2 = "00000000-0000-0000-0000-000000000102";

function req(body: unknown, sig: string | null = "sig"): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sig) headers["x-square-hmacsha256-signature"] = sig;
  return new NextRequest("https://app/api/webhooks/square", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// Default: a configured Square account is found by location id.
function settingsFound() {
  mockPoolQuery.mockResolvedValue({
    rowCount: 1,
    rows: [{ account_id: ACCOUNT, enabled: true, secrets: Buffer.from("x"), webhook_url: null }],
  });
}

// ---------------------------------------------------------------------------
// Fake ledger for the payment path. Answers each SQL statement by its shape and
// keeps payment rows as state, so tests can assert the outcome (which row is
// paid, what is quarantined) instead of the exact order of queries.
// ---------------------------------------------------------------------------
interface FakePayment {
  id: string;
  invoice_id: string;
  account_id: string;
  amount_cents: number;
  status: string;
  external_provider: string | null;
  external_order_id: string | null;
  external_payment_id: string | null;
}
interface FakeInvoice {
  id: string;
  account_id: string;
  square_order_id: string | null;
  total_cents: number;
}
interface FakeState {
  payments: FakePayment[];
  invoices: FakeInvoice[];
  events: { event_type: string; entity_type: string; entity_id: string; payload: Record<string, unknown> }[];
}

function invoiceStatus(state: FakeState, invoiceId: string): { status: string; invoice_number: string } {
  const inv = state.invoices.find((i) => i.id === invoiceId)!;
  const paid = state.payments
    .filter((p) => p.invoice_id === invoiceId && p.status === "paid")
    .reduce((sum, p) => sum + p.amount_cents, 0);
  return { status: paid >= inv.total_cents ? "paid" : "partial", invoice_number: "INV-0001" };
}

function fakeDb(state: FakeState) {
  return async (sql: string, params: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    const none = { rows: [], rowCount: 0 };
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(s)) return none;
    if (/pg_advisory_xact_lock/.test(s)) return none;

    // Duplicate check by Square payment id.
    if (/SELECT 1 FROM payments WHERE external_provider = 'square' AND external_payment_id/.test(s)) {
      const hit = state.payments.filter((p) => p.external_payment_id === params[0]);
      return { rows: hit.map(() => ({ "?column?": 1 })), rowCount: hit.length };
    }

    // Exact match: pending row for this order.
    if (/AND external_order_id = \$2 AND status = 'pending'/.test(s)) {
      const hit = state.payments.filter(
        (p) =>
          p.account_id === params[0] &&
          p.external_provider === "square" &&
          p.external_order_id === params[1] &&
          p.status === "pending"
      );
      return {
        rows: hit.map((p) => ({ id: p.id, invoice_id: p.invoice_id, amount_cents: p.amount_cents })),
        rowCount: hit.length,
      };
    }

    // Legacy fallback: unmatched pending rows on the invoice's current order.
    if (/p\.external_order_id IS NULL/.test(s)) {
      const inv = state.invoices.find((i) => i.account_id === params[0] && i.square_order_id === params[1]);
      const hit = state.payments.filter(
        (p) =>
          !!inv &&
          p.invoice_id === inv.id &&
          p.external_provider === "square" &&
          p.status === "pending" &&
          p.external_order_id === null &&
          p.external_payment_id === null
      );
      return {
        rows: hit.map((p) => ({ id: p.id, invoice_id: p.invoice_id, amount_cents: p.amount_cents })),
        rowCount: hit.length,
      };
    }

    // Invoice lookup by current order id (quarantine target).
    if (/SELECT id FROM invoices WHERE account_id = \$1 AND square_order_id = \$2/.test(s)) {
      const hit = state.invoices.filter((i) => i.account_id === params[0] && i.square_order_id === params[1]);
      return { rows: hit.map((i) => ({ id: i.id })), rowCount: hit.length };
    }

    // Conditional transition: only a pending row becomes paid.
    if (/^UPDATE payments SET status = 'paid'/.test(s) && /AND status = 'pending'/.test(s)) {
      const row = state.payments.find((p) => p.id === params[0] && p.status === "pending");
      if (!row) return none;
      row.status = "paid";
      row.external_payment_id = params[1] as string;
      return { rows: [{ id: row.id }], rowCount: 1 };
    }

    if (/^INSERT INTO workflow_events/.test(s)) {
      // Quarantine passes event type as a literal, with account, type, entity, payload as params.
      // Other events pass account, entity id, payload and use a literal event type.
      if (/'payment\.square_quarantined'/.test(s)) {
        state.events.push({
          event_type: "payment.square_quarantined",
          entity_type: params[1] as string,
          entity_id: params[2] as string,
          payload: JSON.parse(params[3] as string),
        });
      } else {
        const eventType = /'(payment\.recorded|invoice\.paid)'/.exec(s)![1];
        state.events.push({
          event_type: eventType,
          entity_type: "",
          entity_id: params[1] as string,
          payload: JSON.parse(params[2] as string),
        });
      }
      return { rows: [], rowCount: 1 };
    }

    if (/SELECT status, invoice_number FROM invoices/.test(s)) {
      return { rows: [invoiceStatus(state, params[0] as string)], rowCount: 1 };
    }

    return none;
  };
}

function ledger(overrides: Partial<FakeState> = {}): FakeState {
  return {
    invoices: [{ id: INVOICE, account_id: ACCOUNT, square_order_id: "ORD2", total_cents: 12000 }],
    payments: [],
    events: [],
    ...overrides,
  };
}

function pendingRow(id: string, orderId: string | null, amountCents: number): FakePayment {
  return {
    id,
    invoice_id: INVOICE,
    account_id: ACCOUNT,
    amount_cents: amountCents,
    status: "pending",
    external_provider: "square",
    external_order_id: orderId,
    external_payment_id: null,
  };
}

function completedEvent(paymentId: string, orderId: string, amount: number, currency = "USD") {
  return {
    type: "payment.updated",
    data: {
      object: {
        payment: {
          id: paymentId,
          status: "COMPLETED",
          location_id: "LOC1",
          order_id: orderId,
          amount_money: { amount, currency },
        },
      },
    },
  };
}

// Two links on one invoice: ORD1 for $50 (older), ORD2 for $70 (the current link).
function twoLinks(): FakeState {
  return ledger({
    payments: [pendingRow(LINK_ROW_1, "ORD1", 5000), pendingRow(LINK_ROW_2, "ORD2", 7000)],
  });
}

function quarantines(state: FakeState) {
  return state.events.filter((e) => e.event_type === "payment.square_quarantined");
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPool.connect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockVerify.mockResolvedValue(true);
});

describe("POST /api/webhooks/square — guards", () => {
  it("400 when the signature header is missing", async () => {
    const res = await POST(req({ type: "payment.updated" }, null));
    expect(res.status).toBe(400);
  });

  it("acks (200) and does nothing when no location id is present", async () => {
    const res = await POST(req({ type: "payment.updated", data: { object: { payment: {} } } }));
    expect(res.status).toBe(200);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it("400 when the signature fails verification", async () => {
    settingsFound();
    mockVerify.mockResolvedValue(false);
    const res = await POST(
      req({ type: "payment.updated", data: { object: { payment: { id: "P1", status: "COMPLETED", location_id: "LOC1", order_id: "ORD1" } } } })
    );
    expect(res.status).toBe(400);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/square — payment.updated COMPLETED", () => {
  it("marks the pending row for the exact order paid and acks", async () => {
    settingsFound();
    const state = twoLinks();
    mockClientQuery.mockImplementation(fakeDb(state));

    const res = await POST(req(completedEvent("P1", "ORD2", 7000)));
    expect(res.status).toBe(200);

    const paidRow = state.payments.find((p) => p.id === LINK_ROW_2)!;
    expect(paidRow.status).toBe("paid");
    expect(paidRow.external_payment_id).toBe("P1");
    expect(state.payments.find((p) => p.id === LINK_ROW_1)!.status).toBe("pending");
    expect(state.events.map((e) => e.event_type)).toContain("payment.recorded");
    expect(quarantines(state)).toHaveLength(0);
    expect(mockClientQuery.mock.calls.some((c) => /COMMIT/.test(String(c[0])))).toBe(true);
  });

  it("takes an advisory lock on the payment before the duplicate check", async () => {
    settingsFound();
    mockClientQuery.mockImplementation(fakeDb(twoLinks()));
    await POST(req(completedEvent("P1", "ORD2", 7000)));
    const sql = mockClientQuery.mock.calls.map((c) => String(c[0]));
    const lockAt = sql.findIndex((s) => /pg_advisory_xact_lock/.test(s));
    const dupAt = sql.findIndex((s) => /external_payment_id = \$1/.test(s));
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(dupAt);
  });

  it("uses a conditional status = 'pending' update for the transition", async () => {
    settingsFound();
    mockClientQuery.mockImplementation(fakeDb(twoLinks()));
    await POST(req(completedEvent("P1", "ORD2", 7000)));
    const update = mockClientQuery.mock.calls.find((c) => /UPDATE payments/.test(String(c[0])));
    expect(String(update![0])).toMatch(/status = 'paid'/);
    expect(String(update![0])).toMatch(/WHERE id = \$1 AND status = 'pending'/);
  });

  it("multiple links on one invoice: pays the row for the webhook's order, not the oldest", async () => {
    settingsFound();
    const state = twoLinks(); // ORD1 is older and still pending
    mockClientQuery.mockImplementation(fakeDb(state));

    await POST(req(completedEvent("P9", "ORD2", 7000)));

    expect(state.payments.find((p) => p.id === LINK_ROW_2)!.status).toBe("paid");
    expect(state.payments.find((p) => p.id === LINK_ROW_1)!.status).toBe("pending");
  });

  it("out-of-order completion: a later link paid first, then the older link", async () => {
    settingsFound();
    const state = twoLinks();
    mockClientQuery.mockImplementation(fakeDb(state));

    await POST(req(completedEvent("P2", "ORD2", 7000)));
    expect(state.payments.find((p) => p.id === LINK_ROW_2)!.external_payment_id).toBe("P2");

    await POST(req(completedEvent("P1", "ORD1", 5000)));
    const row1 = state.payments.find((p) => p.id === LINK_ROW_1)!;
    expect(row1.status).toBe("paid");
    expect(row1.external_payment_id).toBe("P1");
    expect(state.payments.find((p) => p.id === LINK_ROW_2)!.external_payment_id).toBe("P2");

    // Invoice clears only once both links are paid (12000 total).
    const cleared = state.events.filter((e) => e.event_type === "invoice.paid");
    expect(cleared).toHaveLength(1);
  });

  it("amount mismatch: quarantines and leaves the pending row unpaid", async () => {
    settingsFound();
    const state = twoLinks();
    mockClientQuery.mockImplementation(fakeDb(state));

    const res = await POST(req(completedEvent("P1", "ORD2", 4000)));
    expect(res.status).toBe(200);

    expect(state.payments.find((p) => p.id === LINK_ROW_2)!.status).toBe("pending");
    expect(state.payments.some((p) => p.status === "paid")).toBe(false);
    const q = quarantines(state);
    expect(q).toHaveLength(1);
    expect(q[0].payload.reason).toBe("amount_mismatch");
    expect(q[0].entity_id).toBe(LINK_ROW_2);
    expect(q[0].payload.squareAmountCents).toBe(4000);
  });

  it("currency mismatch: quarantines and leaves the pending row unpaid", async () => {
    settingsFound();
    const state = twoLinks();
    mockClientQuery.mockImplementation(fakeDb(state));

    await POST(req(completedEvent("P1", "ORD2", 7000, "EUR")));

    expect(state.payments.find((p) => p.id === LINK_ROW_2)!.status).toBe("pending");
    const q = quarantines(state);
    expect(q).toHaveLength(1);
    expect(q[0].payload.reason).toBe("currency_mismatch");
  });

  it("no pending row for the order: quarantines without inserting a payment", async () => {
    settingsFound();
    const state = twoLinks();
    mockClientQuery.mockImplementation(fakeDb(state));

    const res = await POST(req(completedEvent("P5", "ORD-UNKNOWN", 7000)));
    expect(res.status).toBe(200);

    expect(state.payments).toHaveLength(2);
    expect(state.payments.some((p) => p.status === "paid")).toBe(false);
    const q = quarantines(state);
    expect(q).toHaveLength(1);
    expect(q[0].payload.reason).toBe("no_pending_link");
    // Unknown order: no invoice to point at, so the event is filed against the account.
    expect(q[0].entity_type).toBe("account");
    expect(q[0].entity_id).toBe(ACCOUNT);
  });

  it("no pending row for a known invoice order: quarantine points at the invoice", async () => {
    settingsFound();
    const state = ledger({
      payments: [{ ...pendingRow(LINK_ROW_2, "ORD2", 7000), status: "paid", external_payment_id: "P0" }],
    });
    mockClientQuery.mockImplementation(fakeDb(state));

    await POST(req(completedEvent("P4", "ORD2", 7000)));

    const q = quarantines(state);
    expect(q).toHaveLength(1);
    expect(q[0].entity_type).toBe("invoice");
    expect(q[0].entity_id).toBe(INVOICE);
  });

  it("missing order id: quarantines and does not pay anything", async () => {
    settingsFound();
    const state = twoLinks();
    mockClientQuery.mockImplementation(fakeDb(state));

    await POST(
      req({
        type: "payment.updated",
        data: { object: { payment: { id: "P6", status: "COMPLETED", location_id: "LOC1", amount_money: { amount: 7000, currency: "USD" } } } },
      })
    );

    expect(state.payments.some((p) => p.status === "paid")).toBe(false);
    expect(quarantines(state)[0].payload.reason).toBe("no_pending_link");
  });

  it("duplicate delivery of the same payment is applied once", async () => {
    settingsFound();
    const state = twoLinks();
    mockClientQuery.mockImplementation(fakeDb(state));
    const evt = completedEvent("P1", "ORD2", 7000);

    await POST(req(evt));
    const eventsAfterFirst = state.events.length;
    const res = await POST(req(evt));

    expect(res.status).toBe(200);
    expect(state.events.length).toBe(eventsAfterFirst);
    expect(state.payments.filter((p) => p.status === "paid")).toHaveLength(1);
    expect(quarantines(state)).toHaveLength(0);
  });

  it("a second payment on an already-paid link is quarantined, not double-counted", async () => {
    settingsFound();
    const state = twoLinks();
    mockClientQuery.mockImplementation(fakeDb(state));

    await POST(req(completedEvent("P1", "ORD2", 7000)));
    await POST(req(completedEvent("P3", "ORD2", 7000)));

    expect(state.payments.find((p) => p.id === LINK_ROW_2)!.external_payment_id).toBe("P1");
    expect(quarantines(state).map((e) => e.payload.reason)).toEqual(["no_pending_link"]);
  });

  it("legacy row without an order id: matched only when it is the invoice's single unmatched pending row", async () => {
    settingsFound();
    const state = ledger({
      payments: [pendingRow("LEGACY", null, 7000)],
    });
    mockClientQuery.mockImplementation(fakeDb(state));

    await POST(req(completedEvent("P7", "ORD2", 7000)));

    expect(state.payments.find((p) => p.id === "LEGACY")!.status).toBe("paid");
  });

  it("legacy ambiguity: two unmatched legacy rows are quarantined, not guessed", async () => {
    settingsFound();
    const state = ledger({
      payments: [pendingRow("LEGACY_A", null, 5000), pendingRow("LEGACY_B", null, 7000)],
    });
    mockClientQuery.mockImplementation(fakeDb(state));

    await POST(req(completedEvent("P8", "ORD2", 7000)));

    expect(state.payments.some((p) => p.status === "paid")).toBe(false);
    expect(quarantines(state)[0].payload.reason).toBe("no_pending_link");
  });

  it("does nothing for a non-completed payment", async () => {
    settingsFound();
    const res = await POST(
      req({ type: "payment.updated", data: { object: { payment: { id: "P1", status: "APPROVED", location_id: "LOC1" } } } })
    );
    expect(res.status).toBe(200);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/square — refund.updated COMPLETED", () => {
  const evt = {
    type: "refund.updated",
    data: { object: { refund: { id: "R1", status: "COMPLETED", location_id: "LOC1", payment_id: "P1", order_id: "ORD1", amount_money: { amount: 1500 } } } },
  };

  it("records a ledger-only refund row attributed to the original payment", async () => {
    settingsFound();
    mockClientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })          // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })          // dup check → none
      .mockResolvedValueOnce({ rows: [{ invoice_id: INVOICE, account_id: ACCOUNT, client_id: "C1", job_id: null, created_by: "U1" }], rowCount: 1 }) // original payment
      .mockResolvedValueOnce({ rows: [{ id: "REFROW" }], rowCount: 1 }) // INSERT refund row
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })          // workflow_events payment.recorded
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });         // COMMIT

    const res = await POST(req(evt));
    expect(res.status).toBe(200);
    const calls = mockClientQuery.mock.calls;
    const insert = calls.find((c) => /INSERT INTO payments/.test(String(c[0])));
    expect(insert).toBeTruthy();
    // payment_type 'refund', status 'refunded' baked into the SQL
    expect(String(insert![0])).toMatch(/'refund', 'refunded'/);
    // workflow event carries paymentType refund
    const wf = calls.find((c) => /payment\.recorded/.test(String(c[0])));
    expect(String(wf![1])).toMatch(/refund/);
  });

  it("ignores a duplicate refund (idempotent)", async () => {
    settingsFound();
    mockClientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })          // BEGIN
      .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 }) // dup → found
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });         // COMMIT
    const res = await POST(req(evt));
    expect(res.status).toBe(200);
    const sql = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => /INSERT INTO payments/.test(s))).toBe(false);
  });
});
