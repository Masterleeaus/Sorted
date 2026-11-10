/**
 * Unit tests for the portal estimate page data path. The share token resolves to
 * an account first; the estimate and its items and options are read in that
 * account's context. An unknown token is notFound, and the attention event runs
 * in its own account-context transaction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ESTIMATE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
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
  estimate: null as null | Record<string, unknown>,
  contexts: [] as string[],
  log: [] as { sql: string; params?: unknown[]; account: string | undefined }[],
  emitted: [] as Record<string, unknown>[],
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/db", () => ({
  queryOne: async (sql: string) => {
    if (sql.includes("resolve_estimate_share_account")) return { account_id: state.resolvedAccount };
    throw new Error(`unexpected queryOne: ${sql}`);
  },
}));

vi.mock("@/app/api/_lib/account-context", () => ({
  withTokenAccountContext: async (accountId: string, fn: (tx: unknown) => Promise<unknown>) => {
    state.contexts.push(accountId);
    const tx = {
      query: async (sql: string, params?: unknown[]) => {
        state.log.push({ sql, params, account: state.contexts.at(-1) });
        if (sql.includes("FROM estimates e")) return { rows: state.estimate ? [state.estimate] : [] };
        if (sql.includes("FROM estimate_line_items")) return { rows: [{ id: "li1", option_id: null, sort_order: 1 }] };
        if (sql.includes("FROM estimate_options")) return { rows: [{ id: "op1", sort_order: 1 }] };
        return { rows: [] };
      },
    };
    return fn(tx, accountId);
  },
}));

vi.mock("@/lib/portal/session", () => ({
  isPortalPreview: async () => false,
}));

vi.mock("@/lib/attention", () => ({
  emitAttentionEvent: async (_tx: unknown, input: Record<string, unknown>) => {
    state.emitted.push(input);
  },
}));

vi.mock("../EstimatePortalClient", () => ({ EstimatePortalClient: () => null }));

import EstimatePortalPage from "../page";

const run = () => EstimatePortalPage({ params: Promise.resolve({ token: TOKEN }) });

beforeEach(() => {
  state.resolvedAccount = ACCOUNT;
  state.estimate = {
    id: ESTIMATE, account_id: ACCOUNT, client_id: CLIENT, client_name: "Pat Portal", status: "sent",
  };
  state.contexts = [];
  state.log = [];
  state.emitted = [];
});

describe("portal estimate page", () => {
  it("returns notFound and opens no tenant transaction for an unknown token", async () => {
    state.resolvedAccount = null;
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.contexts).toEqual([]);
  });

  it("returns notFound when the token's account has no matching estimate", async () => {
    state.estimate = null;
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.contexts).toEqual([ACCOUNT]);
  });

  it("reads the estimate with the share token and account predicate, then its items and options in context", async () => {
    const element = (await run()) as unknown as { props: { estimate: { id: string }; lineItems: unknown[]; options: unknown[] } };
    expect(element.props.estimate.id).toBe(ESTIMATE);
    expect(element.props.lineItems).toHaveLength(1);
    expect(element.props.options).toHaveLength(1);
    const main = state.log.find((entry) => entry.sql.includes("FROM estimates e"));
    expect(main?.params).toEqual([TOKEN, ACCOUNT]);
    expect(state.log.every((entry) => entry.account === ACCOUNT)).toBe(true);
  });

  it("emits the first-open attention event inside the account context", async () => {
    await run();
    expect(state.emitted).toEqual([
      expect.objectContaining({ accountId: ACCOUNT, type: "estimate.opened", entityId: ESTIMATE }),
    ]);
    expect(state.contexts).toEqual([ACCOUNT, ACCOUNT]);
  });
});
