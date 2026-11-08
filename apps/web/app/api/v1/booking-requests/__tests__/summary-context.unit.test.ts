import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSession = {
  userId: "00000000-0000-0000-0000-000000000001",
  accountId: "00000000-0000-0000-0000-000000000002",
  role: "owner" as const,
  traceId: "00000000-0000-0000-0000-000000000099",
};
const BOOKING_ID = "00000000-0000-0000-0000-0000000000b1";

vi.mock("@/lib/auth/middleware", () => ({
  withRole: (_roles: string[], handler: Function) => (req: NextRequest) => handler(req, mockSession),
}));

const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn();

vi.mock("pg", () => ({
  Pool: class {
    connect = mockConnect;
  },
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ DATABASE_URL: "postgres://unused/test" }) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class {} }));

import { POST } from "../[id]/summary/route";

const request = () =>
  new NextRequest(`http://localhost/api/v1/booking-requests/${BOOKING_ID}/summary`, { method: "POST" });

beforeEach(() => {
  vi.resetAllMocks();
  mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
  mockClientQuery.mockResolvedValue({ rows: [] });
});

describe("POST /api/v1/booking-requests/[id]/summary account context", () => {
  it("looks up the booking in a session with the account context and account predicate", async () => {
    const res = await POST(request());
    expect(res.status).toBe(404);

    const calls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toContain("set_config('app.current_account_id'");
    const lookup = mockClientQuery.mock.calls.find((c) => String(c[0]).includes("FROM booking_requests"));
    expect(lookup?.[0]).toMatch(/account_id = \$2/);
    expect(lookup?.[1]).toEqual([BOOKING_ID, mockSession.accountId]);
    expect(calls).toContain("COMMIT");
  });
});
