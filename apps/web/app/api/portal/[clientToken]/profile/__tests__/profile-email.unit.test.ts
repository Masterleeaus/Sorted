/**
 * Unit tests for the portal profile route's email-change path. The pool is a
 * recording fake: each test checks that the email lookup and the magic-link
 * insert run after the account context is set for the guarded client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const calls = vi.hoisted(() => ({ log: [] as { sql: string; params?: unknown[] }[], takenRow: null as unknown }));

const fakeClient = vi.hoisted(() => ({
  query: async (sql: string, params?: unknown[]) => {
    calls.log.push({ sql, params });
    if (sql.includes("FROM clients WHERE account_id")) return { rows: calls.takenRow ? [calls.takenRow] : [] };
    if (sql.includes("INSERT INTO portal_magic_links")) return { rows: [{ token: "magic-1" }] };
    return { rows: [] };
  },
  release: () => {},
}));

vi.mock("@/lib/db", () => ({
  getPool: () => ({ connect: async () => fakeClient }),
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock("@/lib/portal/guard", () => ({
  requirePortalClient: async () => ({
    client: {
      id: CLIENT,
      account_id: ACCOUNT,
      name: "Pat Portal",
      email: "old@example.com",
      phone: null,
      preferred_contact: "email",
      sms_consent: false,
    },
  }),
}));

vi.mock("@/lib/email/mailer", () => ({
  appUrl: () => "https://app.example",
  sendEmail: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/attention", () => ({ emitAttentionEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/db/audit", () => ({ appendAuditLog: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { PATCH } from "../route";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/portal/tok/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.50" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ clientToken: "tok" }) };

beforeEach(() => {
  calls.log = [];
  calls.takenRow = null;
});

describe("PATCH /api/portal/[clientToken]/profile — email change", () => {
  it("checks the email is free and inserts the magic link inside the client's account context", async () => {
    const res = await PATCH(req({ email: "new@example.com" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, emailPending: true });

    const sqls = calls.log.map((c) => c.sql);
    const ctx = sqls.findIndex((s) => s.includes("set_config('app.current_account_id'"));
    const taken = sqls.findIndex((s) => s.includes("FROM clients WHERE account_id"));
    const link = sqls.findIndex((s) => s.includes("INSERT INTO portal_magic_links"));
    expect(ctx).toBeGreaterThanOrEqual(0);
    expect(taken).toBeGreaterThan(ctx);
    expect(link).toBeGreaterThan(ctx);
    expect(calls.log[ctx].params?.[0]).toBe(ACCOUNT);
    expect(calls.log[taken].params).toEqual([ACCOUNT, CLIENT, "new@example.com"]);
  });

  it("returns 409 and writes no magic link when another client already uses the email", async () => {
    calls.takenRow = { "?column?": 1 };
    const res = await PATCH(req({ email: "taken@example.com" }), params);
    expect(res.status).toBe(409);
    expect(calls.log.some((c) => c.sql.includes("INSERT INTO portal_magic_links"))).toBe(false);
  });
});
