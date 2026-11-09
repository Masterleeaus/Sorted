/**
 * Unit tests for POST /api/internal/arrival-prompt. The candidate resolves to its
 * account through the migration 204 resolver, then the ack runs in that account's
 * context as its owner.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockQueryOne, mockClientQuery } = vi.hoisted(() => {
  process.env.LOCATION_INTERNAL_KEY = "test-internal-key";
  return { mockQueryOne: vi.fn(), mockClientQuery: vi.fn() };
});

vi.mock("@/lib/db", () => ({
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  getPool: () => ({
    connect: async () => ({ query: (...args: unknown[]) => mockClientQuery(...args), release: () => {} }),
  }),
}));

import { POST } from "../route";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CANDIDATE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function post(body: unknown, key: string | null = "test-internal-key"): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers["x-api-key"] = key;
  return new NextRequest("http://localhost/api/internal/arrival-prompt", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockClientQuery.mockImplementation(async (sql: string) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.startsWith("SELECT set_config")) return { rows: [] };
    if (sql.startsWith("UPDATE visit_candidates")) {
      return { rows: [{ id: CANDIDATE, live_prompted_at: "2026-09-05T20:00:00Z" }] };
    }
    return { rows: [] };
  });
});

describe("POST /api/internal/arrival-prompt", () => {
  it("401 without the internal key, before any lookup", async () => {
    const res = await POST(post({ candidate_id: CANDIDATE, action: "prompted" }, null));
    expect(res.status).toBe(401);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it("404 not_found when the resolver finds no candidate, and opens no tenant transaction", async () => {
    mockQueryOne.mockResolvedValue({ account_id: null });
    const res = await POST(post({ candidate_id: CANDIDATE, action: "prompted" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, reason: "not_found" });
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it("resolves the account, then updates the candidate inside that account's owner context", async () => {
    mockQueryOne.mockResolvedValue({ account_id: ACCOUNT });
    const res = await POST(post({ candidate_id: CANDIDATE, action: "prompted" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, already: true });

    expect(mockQueryOne.mock.calls[0][0]).toMatch(/resolve_visit_candidate_account\(\$1::uuid\)/);
    const sqls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    const ctxIdx = sqls.findIndex((s) => s.startsWith("SELECT set_config"));
    const updIdx = sqls.findIndex((s) => s.startsWith("UPDATE visit_candidates"));
    expect(ctxIdx).toBeGreaterThanOrEqual(0);
    expect(updIdx).toBeGreaterThan(ctxIdx);
    expect(mockClientQuery.mock.calls[ctxIdx][1]).toEqual([ACCOUNT, "owner"]);
    expect(mockClientQuery.mock.calls[updIdx][1]).toEqual([CANDIDATE, ACCOUNT]);
  });

  it("404 not_found when the candidate is no longer pending", async () => {
    mockQueryOne.mockResolvedValue({ account_id: ACCOUNT });
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith("UPDATE visit_candidates")) return { rows: [] };
      return { rows: [] };
    });
    const res = await POST(post({ candidate_id: CANDIDATE, action: "prompted" }));
    expect(res.status).toBe(404);
  });
});
