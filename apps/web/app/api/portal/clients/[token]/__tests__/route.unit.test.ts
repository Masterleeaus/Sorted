/**
 * Unit tests for GET /api/portal/clients/[token]. The pool is a recording fake.
 * The checks: the token lookup is the only read before context, every read after
 * it runs in the resolved account's context with an account predicate, and an
 * unknown token returns 404 without opening a tenant transaction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const state = vi.hoisted(() => ({
  log: [] as { sql: string; params?: unknown[] }[],
  client: null as null | Record<string, unknown>,
  connects: 0,
}));

const fakeClient = vi.hoisted(() => ({
  query: async (sql: string, params?: unknown[]) => {
    state.log.push({ sql, params });
    if (sql.startsWith("SELECT set_config")) return { rows: [] };
    if (sql.includes("FROM estimates")) return { rows: [{ id: "e1" }] };
    if (sql.includes("FROM invoices")) return { rows: [{ id: "i1" }] };
    if (sql.includes("FROM maintenance_plans")) return { rows: [{ id: "p1" }] };
    if (sql.includes("FROM jobs")) return { rows: [{ id: "j1" }] };
    return { rows: [] };
  },
  release: () => {},
}));

vi.mock("@/lib/db", () => ({
  getPool: () => ({
    connect: async () => {
      state.connects++;
      return fakeClient;
    },
  }),
  queryOne: async (sql: string, params?: unknown[]) => {
    state.log.push({ sql, params });
    return state.client;
  },
}));

import { GET } from "../route";

const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
const req = () => new NextRequest("http://localhost:3000/api/portal/clients/tok");

beforeEach(() => {
  state.log = [];
  state.connects = 0;
  state.client = {
    id: CLIENT,
    account_id: ACCOUNT,
    name: "Pat Portal",
    email: "pat@example.com",
    account_name: "Dovetails",
  };
});

describe("GET /api/portal/clients/[token]", () => {
  it("returns 404 and opens no tenant transaction for an unknown token", async () => {
    state.client = null;
    const res = await GET(req(), ctx("nope"));
    expect(res.status).toBe(404);
    expect(state.connects).toBe(0);
  });

  it("runs every read after setting the resolved account context, with account predicates", async () => {
    const res = await GET(req(), ctx("tok"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["client", "estimates", "invoices", "maintenanceJobs", "plans"]);
    expect(body.client).toEqual({ name: "Pat Portal", email: "pat@example.com", accountName: "Dovetails" });
    expect(body.estimates).toEqual([{ id: "e1" }]);

    const sqls = state.log.map((c) => c.sql);
    const ctxIdx = sqls.findIndex((s) => s.includes("set_config('app.current_account_id'"));
    expect(ctxIdx).toBeGreaterThan(0);
    expect(state.log[ctxIdx].params?.[0]).toBe(ACCOUNT);

    const reads = state.log.slice(ctxIdx + 1).filter((c) => c.sql.includes("FROM "));
    expect(reads).toHaveLength(4);
    for (const read of reads) {
      expect(read.sql).toMatch(/account_id = \$2/);
      expect(read.params).toEqual([CLIENT, ACCOUNT]);
    }
  });
});
