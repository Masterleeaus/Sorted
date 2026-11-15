/**
 * Unit tests for the public intake page data path. An open invite resolves to an
 * account through migration 204, and the lead is read in that account's context.
 * A used link, an expired link, an unknown link and a lookup failure each keep the
 * user-visible result the page had before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INVITE = "22222222-2222-4222-8222-222222222222";
const TOKEN = "11111111-1111-4111-8111-111111111111";

vi.hoisted(() => {
  (globalThis as { React?: unknown }).React = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
      type,
      props: { ...props, children: children.length === 1 ? children[0] : children },
    }),
    Fragment: "Fragment",
  };
});

const state = vi.hoisted(() => ({
  open: null as null | { id: string; account_id: string },
  check: null as null | { is_used: boolean },
  failOpen: false,
  invite: null as null | Record<string, unknown>,
  contexts: [] as string[],
  queried: [] as string[],
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/db", () => ({
  queryOne: async (sql: string) => {
    state.queried.push(sql);
    if (sql.includes("resolve_open_intake_invite")) {
      if (state.failOpen) throw new Error("db down");
      return state.open;
    }
    if (sql.includes("resolve_intake_invite_state")) return state.check;
    throw new Error(`unexpected queryOne: ${sql}`);
  },
}));

vi.mock("@/app/api/_lib/account-context", () => ({
  withTokenAccountContext: async (accountId: string, fn: (tx: unknown) => Promise<unknown>) => {
    state.contexts.push(accountId);
    const tx = {
      query: async (sql: string) => {
        if (sql.includes("FROM intake_invites")) return { rows: state.invite ? [state.invite] : [] };
        return { rows: [] };
      },
    };
    return fn(tx);
  },
}));

vi.mock("../IntakeClientForm", () => ({ IntakeClientForm: () => null }));

import PublicIntakePage from "../page";

const run = () => PublicIntakePage({ params: Promise.resolve({ token: TOKEN }) });

/** Collects every text string in a rendered element tree. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  const el = node as { props?: { children?: unknown } };
  return textOf(el.props?.children);
}

beforeEach(() => {
  state.open = { id: INVITE, account_id: ACCOUNT };
  state.check = null;
  state.failOpen = false;
  state.invite = {
    id: INVITE, account_id: ACCOUNT, booking_request_id: null, token: TOKEN,
    lead_name: "Pat", lead_email: "pat@example.com", lead_phone: "5551234",
    expires_at: new Date(Date.now() + 3600_000).toISOString(), used_at: null,
  };
  state.contexts = [];
  state.queried = [];
});

describe("public intake page", () => {
  it("renders the form for an open invite, reading the lead inside the account context", async () => {
    const element = (await run()) as unknown as { props: { children: unknown[] } };
    expect(JSON.stringify(element)).toContain("5551234");
    expect(state.contexts).toEqual([ACCOUNT]);
  });

  it("shows the already-submitted message for a used link", async () => {
    state.open = null;
    state.check = { is_used: true };
    const text = textOf(await run());
    expect(text).toContain("Already submitted");
    expect(state.contexts).toEqual([]);
  });

  it("shows the expired message for a link that exists but is not open", async () => {
    state.open = null;
    state.check = { is_used: false };
    expect(textOf(await run())).toContain("Link expired");
  });

  it("returns notFound for a token that matches no invite", async () => {
    state.open = null;
    state.check = null;
    await expect(run()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows the try-again message when the lookup fails", async () => {
    state.failOpen = true;
    expect(textOf(await run())).toContain("Something went wrong");
  });
});
