/**
 * Unit tests for the itemized receipts page data path. The share token resolves to
 * an account first; the invoice and its receipts are read in that account's
 * context. An unknown token, or an invoice without a job, is notFound.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INVOICE = "99999999-9999-4999-8999-999999999999";
const JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
  contexts: [] as string[],
  receiptCalls: [] as { accountId: string; jobId: string; invoiceId: string }[],
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
      query: async (sql: string) => {
        if (sql.includes("FROM invoices i")) return { rows: state.invoice ? [state.invoice] : [] };
        return { rows: [] };
      },
    };
    return fn(tx, accountId);
  },
}));

vi.mock("@/lib/invoices/itemized-receipts", () => ({
  loadItemizedReceipts: async (_db: unknown, accountId: string, jobId: string, invoiceId: string) => {
    state.receiptCalls.push({ accountId, jobId, invoiceId });
    return { receipts: [], total_cents: 0 };
  },
}));

import InvoiceReceiptsPage from "../page";

const run = () => InvoiceReceiptsPage({ params: Promise.resolve({ token: TOKEN }) });

beforeEach(() => {
  state.resolvedAccount = ACCOUNT;
  state.invoice = {
    id: INVOICE, account_id: ACCOUNT, job_id: JOB, invoice_number: "1001",
    account_name: "Dovetails", property_address: "1 Main St",
  };
  state.contexts = [];
  state.receiptCalls = [];
});

describe("invoice receipts page", () => {
  it("returns notFound and opens no tenant transaction for an unknown token", async () => {
    state.resolvedAccount = null;
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.contexts).toEqual([]);
    expect(state.receiptCalls).toEqual([]);
  });

  it("returns notFound when the invoice has no job, without loading receipts", async () => {
    state.invoice = { ...state.invoice, job_id: null };
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.receiptCalls).toEqual([]);
  });

  it("loads receipts for the resolved account, job and invoice", async () => {
    await run();
    expect(state.contexts).toEqual([ACCOUNT]);
    expect(state.receiptCalls).toEqual([{ accountId: ACCOUNT, jobId: JOB, invoiceId: INVOICE }]);
  });
});
