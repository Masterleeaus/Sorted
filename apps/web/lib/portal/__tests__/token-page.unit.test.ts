/**
 * Unit tests for withPortalTokenPage. The resolver and the account-context
 * wrapper are mocked at their module boundary. The checks: a malformed or unknown
 * token never opens a tenant transaction, and a resolved token runs its callback
 * inside that account's context.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
  resolved: null as null | { account_id: string | null },
  resolverCalls: [] as { sql: string; params?: unknown[] }[],
  contexts: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  queryOne: async (sql: string, params?: unknown[]) => {
    state.resolverCalls.push({ sql, params });
    return state.resolved;
  },
}));

vi.mock("@/app/api/_lib/account-context", () => ({
  withTokenAccountContext: async (accountId: string, fn: (tx: unknown) => Promise<unknown>) => {
    state.contexts.push(accountId);
    return fn({ marker: "tx" });
  },
}));

import { withPortalTokenPage } from "../token-page";

beforeEach(() => {
  state.resolved = { account_id: ACCOUNT };
  state.resolverCalls = [];
  state.contexts = [];
});

describe("withPortalTokenPage", () => {
  it("returns null without any database call for a malformed token", async () => {
    const fn = vi.fn();
    const result = await withPortalTokenPage("resolve_portal_client_account", "not-a-uuid", fn);
    expect(result).toBeNull();
    expect(state.resolverCalls).toEqual([]);
    expect(state.contexts).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns null and opens no tenant transaction when the token matches nothing", async () => {
    state.resolved = { account_id: null };
    const fn = vi.fn();
    const result = await withPortalTokenPage("resolve_estimate_share_account", TOKEN, fn);
    expect(result).toBeNull();
    expect(state.contexts).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("resolves through the named migration 204 resolver with the token as a bound parameter", async () => {
    await withPortalTokenPage("resolve_invoice_share_account", TOKEN, async () => null);
    expect(state.resolverCalls).toEqual([
      { sql: "SELECT resolve_invoice_share_account($1::uuid) AS account_id", params: [TOKEN] },
    ]);
  });

  it("runs the callback in the resolved account's context and passes that account id", async () => {
    const seen: { tx: unknown; accountId: string }[] = [];
    const result = await withPortalTokenPage("resolve_portal_client_account", TOKEN, async (tx, accountId) => {
      seen.push({ tx, accountId });
      return "ok";
    });
    expect(result).toBe("ok");
    expect(state.contexts).toEqual([ACCOUNT]);
    expect(seen).toEqual([{ tx: { marker: "tx" }, accountId: ACCOUNT }]);
  });
});
