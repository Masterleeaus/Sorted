/**
 * Unit tests for the portal property history page data path. The client, the
 * property and the history reads all run in the token's account context. An
 * unknown token is notFound, a missing session redirects, and a property that is
 * not the client's is notFound.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROPERTY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TOKEN = "11111111-1111-4111-8111-111111111111";

// The vitest transform emits classic JSX. The page builds elements only, so a stub is enough.
vi.hoisted(() => {
  (globalThis as { React?: unknown }).React = {
    createElement: (type: unknown, props: unknown) => ({ type, props }),
    Fragment: "Fragment",
  };
});

const state = vi.hoisted(() => ({
  resolvedAccount: null as string | null,
  client: null as null | Record<string, unknown>,
  property: null as null | Record<string, unknown>,
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
  queryOne: async (sql: string) => {
    if (sql.includes("resolve_portal_client_account")) return { account_id: state.resolvedAccount };
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
        if (sql.includes("FROM properties")) return { rows: state.property ? [state.property] : [] };
        return { rows: [] };
      },
    };
    return fn(tx);
  },
}));

vi.mock("@/lib/portal/session", () => ({
  getPortalSession: async () => state.session,
}));

import PortalPropertyPage from "../page";

const run = () =>
  PortalPropertyPage({
    params: Promise.resolve({ clientToken: TOKEN, propertyId: PROPERTY }),
  });

beforeEach(() => {
  state.resolvedAccount = ACCOUNT;
  state.client = { id: CLIENT, name: "Pat Portal", account_id: ACCOUNT, account_name: "Dovetails" };
  state.property = { id: PROPERTY, name: null, address: "1 Main St", city: null, state: null, zip: null };
  state.session = { clientId: CLIENT, isPreview: false };
  state.contexts = [];
  state.log = [];
});

describe("portal property history page", () => {
  it("returns notFound and opens no tenant transaction for an unknown token", async () => {
    state.resolvedAccount = null;
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.contexts).toEqual([]);
  });

  it("redirects to login without a portal session", async () => {
    state.session = null;
    await expect(run()).rejects.toThrow("NEXT_REDIRECT:/portal/login");
    expect(state.log.every((entry) => entry.account === ACCOUNT)).toBe(true);
  });

  it("returns notFound for a property that is not this client's", async () => {
    state.property = null;
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
    // The history reads are skipped when the property does not belong to the client.
    expect(state.log.some((entry) => entry.sql.includes("property_condition_snapshots"))).toBe(false);
  });

  it("runs the property and history reads in the account context with the account predicate", async () => {
    const element = await run();
    expect(element).toBeTruthy();
    expect(state.contexts).toEqual([ACCOUNT]);
    expect(state.log.every((entry) => entry.account === ACCOUNT)).toBe(true);
    const snapshots = state.log.find((entry) => entry.sql.includes("property_condition_snapshots"));
    expect(snapshots?.params).toEqual([ACCOUNT, PROPERTY]);
    const propertyRead = state.log.find((entry) => entry.sql.includes("FROM properties"));
    expect(propertyRead?.params).toEqual([PROPERTY, CLIENT, ACCOUNT]);
  });
});
