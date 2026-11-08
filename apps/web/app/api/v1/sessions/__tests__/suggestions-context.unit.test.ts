import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSession = {
  userId: "00000000-0000-0000-0000-000000000001",
  accountId: "00000000-0000-0000-0000-000000000002",
  role: "owner" as const,
  traceId: "00000000-0000-0000-0000-000000000099",
};

vi.mock("@/lib/auth/middleware", () => ({
  withAuth: (handler: Function) => (req: NextRequest) => handler(req, mockSession),
}));

const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn();

// withDbSession builds its pool internally, so the pg Pool is mocked rather than getPool.
vi.mock("pg", () => ({
  Pool: class {
    connect = mockConnect;
  },
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ DATABASE_URL: "postgres://unused/test" }) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { GET } from "../suggestions/route";

const request = () => new NextRequest("http://localhost/api/v1/sessions/suggestions?date=2026-05-04");

beforeEach(() => {
  vi.resetAllMocks();
  mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
  mockClientQuery.mockResolvedValue({ rows: [] });
});

describe("GET /api/v1/sessions/suggestions account context", () => {
  it("sets the session account context in the transaction before any query", async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);

    const calls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toContain("set_config('app.current_account_id'");
    expect(mockClientQuery.mock.calls[1]?.[1]).toEqual([mockSession.userId, mockSession.accountId, mockSession.role]);
    expect(calls.at(-1)).toBe("COMMIT");
    expect(mockClientRelease).toHaveBeenCalled();
  });

  it("scopes every query by the session account id", async () => {
    await GET(request());
    const dataCalls = mockClientQuery.mock.calls.filter((c) => /FROM (jobs|visits|estimates)/.test(String(c[0])));
    expect(dataCalls).toHaveLength(3);
    for (const [sql, params] of dataCalls) {
      expect(String(sql)).toMatch(/account_id = \$1/);
      expect(params).toEqual([mockSession.accountId, "2026-05-04"]);
    }
  });

  it("returns 500 and rolls back when the query fails", async () => {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FROM jobs")) throw new Error("boom");
      return { rows: [] };
    });
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(mockClientQuery.mock.calls.map((c) => String(c[0]))).toContain("ROLLBACK");
  });
});
