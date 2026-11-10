/**
 * Unit tests for the portal home page data path. The token resolves to an account
 * first; the client and every read run in that account's context. An unknown token
 * is notFound with no tenant transaction, and a missing portal session redirects
 * to login.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TOKEN = "11111111-1111-4111-8111-111111111111";

// The vitest transform emits classic JSX. The page builds elements only and never
// renders them here, so a stub createElement is enough and the shared config stays as is.
vi.hoisted(() => {
  (globalThis as { React?: unknown }).React = {
    createElement: (type: unknown, props: unknown) => ({ type, props }),
    Fragment: "Fragment",
  };
});

const state = vi.hoisted(() => ({
  resolvedAccount: null as string | null,
  client: null as null | Record<string, unknown>,
  session: null as null | { clientId: string; isPreview: boolean },
  contexts: [] as string[],
  log: [] as { sql: string; params?: unknown[]; account: string | undefined }[],
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("@/lib/db", () => ({
  getPool: () => {
    throw new Error("portal page must not use the bare pool");
  },
  queryOne: async (sql: string) => {
    if (sql.includes("resolve_portal_client_account")) {
      return { account_id: state.resolvedAccount };
    }
    throw new Error(`unexpected queryOne: ${sql}`);
  },
  query: async () => {
    throw new Error("portal page must not run plain query()");
  },
}));

vi.mock("@/app/api/_lib/account-context", () => ({
  withTokenAccountContext: async (accountId: string, fn: (tx: unknown) => Promise<unknown>) => {
    state.contexts.push(accountId);
    const tx = {
      query: async (sql: string, params?: unknown[]) => {
        state.log.push({ sql, params, account: state.contexts.at(-1) });
        if (sql.includes("FROM clients c")) return { rows: state.client ? [state.client] : [] };
        return { rows: [] };
      },
    };
    return fn(tx);
  },
}));

vi.mock("@/lib/portal/session", () => ({
  getPortalSession: async () => state.session,
}));

import ClientPortalPage from "../page";

const run = () =>
  ClientPortalPage({
    params: Promise.resolve({ clientToken: TOKEN }),
    searchParams: Promise.resolve({}),
  });

beforeEach(() => {
  state.resolvedAccount = ACCOUNT;
  state.client = {
    id: CLIENT,
    name: "Pat Portal",
    email: "pat@example.com",
    phone: null,
    account_id: ACCOUNT,
    account_name: "Dovetails",
    preferred_contact: "email",
    sms_consent: false,
  };
  state.session = { clientId: CLIENT, isPreview: false };
  state.contexts = [];
  state.log = [];
});

describe("portal home page", () => {
  it("returns notFound and opens no tenant transaction for an unknown token", async () => {
    state.resolvedAccount = null;
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.contexts).toEqual([]);
  });

  it("returns notFound when the resolved account has no matching client", async () => {
    state.client = null;
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.contexts).toEqual([ACCOUNT]);
  });

  it("redirects to login without a portal session, after reads that ran in the account context", async () => {
    state.session = null;
    await expect(run()).rejects.toThrow("NEXT_REDIRECT:/portal/login");
    expect(state.contexts).toEqual([ACCOUNT]);
    expect(state.log.every((entry) => entry.account === ACCOUNT)).toBe(true);
  });

  it("runs every data read in the resolved account's context and scopes the client id", async () => {
    const element = await run();
    expect(element).toBeTruthy();
    expect(state.contexts).toEqual([ACCOUNT]);
    expect(state.log.length).toBeGreaterThan(5);
    expect(state.log.every((entry) => entry.account === ACCOUNT)).toBe(true);
    const estimates = state.log.find((entry) => entry.sql.includes("FROM estimates e"));
    expect(estimates?.params).toEqual([CLIENT]);
  });
});
