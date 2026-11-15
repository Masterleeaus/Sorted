/**
 * Unit tests for the portal invoice page data path. The share token resolves to an
 * account first. The invoice, its line items and the Square settings are read in
 * that account's context. An unknown token is notFound. Staff viewers never stamp
 * the view.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INVOICE = "99999999-9999-4999-8999-999999999999";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN = "11111111-1111-4111-8111-111111111111";

vi.hoisted(() => {
  (globalThis as { React?: unknown }).React = {
    createElement: (type: unknown, props: unknown) => ({ type, props }),
    Fragment: "Fragment",
  };
});

const state = vi.hoisted(() => ({
  resolvedAccount: null as string | null,
  invoice: null as null | Record<string, unknown>,
  staffAccount: null as string | null,
  preview: false,
  contexts: [] as string[],
  log: [] as { sql: string; params?: unknown[]; account: string | undefined }[],
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/db", () => ({
  queryOne: async (sql: string) => {
    if (sql.includes("resolve_invoice_share_account")) return { account_id: state.resolvedAccount };
    throw new Error(`unexpected queryOne: ${sql}`);
  },
}));

vi.mock("@/app/api/_lib/account-context", () => ({
  withTokenAccountContext: async (accountId: string, fn: (tx: unknown) => Promise<unknown>) => {
    state.contexts.push(accountId);
    const tx = {
      query: async (sql: string, params?: unknown[]) => {
        state.log.push({ sql, params, account: state.contexts.at(-1) });
        if (sql.includes("FROM invoices i")) return { rows: state.invoice ? [state.invoice] : [] };
        if (sql.includes("FROM invoice_line_items")) return { rows: [{ id: "li1", sort_order: 1 }] };
        return { rows: [] };
      },
    };
    return fn(tx, accountId);
  },
}));

vi.mock("@/lib/portal/session", () => ({
  isPortalPreview: async () => state.preview,
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: async () => (state.staffAccount ? { accountId: state.staffAccount } : null),
}));

vi.mock("@/lib/integrations/square-payments", () => ({
  loadSquareSettings: async (tx: { query: unknown }, accountId: string) => {
    state.log.push({ sql: "loadSquareSettings", account: accountId });
    return { enabled: true, secrets: { accessToken: "token" }, config: { locationId: "L1" } };
  },
}));

const viewStamp = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/invoices/client-view", () => ({
  recordInvoicePortalView: async () => {
    viewStamp.calls++;
    return { updated: true, firstOpen: false };
  },
}));

vi.mock("@/lib/attention", () => ({ emitAttentionEvent: async () => undefined }));

vi.mock("../InvoicePortalClient", () => ({ InvoicePortalClient: () => null }));

import InvoicePortalPage from "../page";

const run = () => InvoicePortalPage({ params: Promise.resolve({ token: TOKEN }) });

beforeEach(() => {
  state.resolvedAccount = ACCOUNT;
  state.invoice = {
    id: INVOICE, account_id: ACCOUNT, client_id: CLIENT, status: "sent", invoice_number: "1001",
    total_cents: 1000, paid_cents: 0, client_name: "Pat Portal", account_name: "Dovetails",
    account_settings: {}, invoice_kind: "standard", sponsored_purpose: null,
  };
  state.staffAccount = null;
  state.preview = false;
  state.contexts = [];
  state.log = [];
  viewStamp.calls = 0;
});

describe("portal invoice page", () => {
  it("returns notFound and opens no tenant transaction for an unknown token", async () => {
    state.resolvedAccount = null;
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.contexts).toEqual([]);
  });

  it("reads the invoice by share token and account, and its line items, in the account context", async () => {
    const element = (await run()) as unknown as { props: { invoice: { id: string }; onlinePaymentAvailable: boolean } };
    expect(element.props.invoice.id).toBe(INVOICE);
    const main = state.log.find((entry) => entry.sql.includes("FROM invoices i"));
    expect(main?.params).toEqual([TOKEN, ACCOUNT]);
    expect(state.log.every((entry) => entry.account === ACCOUNT)).toBe(true);
    expect(element.props.onlinePaymentAvailable).toBe(true);
  });

  it("stamps the client view inside the account context", async () => {
    await run();
    expect(viewStamp.calls).toBe(1);
    expect(state.contexts).toEqual(expect.arrayContaining([ACCOUNT]));
  });

  it("does not stamp the view for a staff viewer of the same account", async () => {
    state.staffAccount = ACCOUNT;
    await run();
    expect(viewStamp.calls).toBe(0);
  });

  it("offers no online payment in an admin preview", async () => {
    state.preview = true;
    const element = (await run()) as unknown as { props: { onlinePaymentAvailable: boolean } };
    expect(element.props.onlinePaymentAvailable).toBe(false);
    expect(state.log.some((entry) => entry.sql === "loadSquareSettings")).toBe(false);
  });
});
