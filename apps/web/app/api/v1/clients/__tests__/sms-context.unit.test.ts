import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSession = {
  userId: "00000000-0000-0000-0000-000000000001",
  accountId: "00000000-0000-0000-0000-000000000002",
  role: "owner" as const,
  traceId: "00000000-0000-0000-0000-000000000099",
};
const CLIENT_ID = "00000000-0000-0000-0000-0000000000c1";

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
vi.mock("@/lib/sms/outbound", () => ({
  findActiveJobForClient: vi.fn(),
  logOutboundSms: vi.fn(),
}));
vi.mock("@/lib/sms/gateway", () => ({
  isSmsGatewayConfigured: () => true,
  sendSmsViaGateway: vi.fn(),
}));

import { POST } from "../../clients/[id]/sms/route";

const request = () =>
  new NextRequest(`http://localhost/api/v1/clients/${CLIENT_ID}/sms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Hello" }),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
  mockClientQuery.mockResolvedValue({ rows: [] });
});

describe("POST /api/v1/clients/[id]/sms account context", () => {
  it("runs the client lookup in a session with the account context and account predicate", async () => {
    const res = await POST(request());
    expect(res.status).toBe(404);

    const calls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toContain("set_config('app.current_account_id'");
    const lookup = mockClientQuery.mock.calls.find((c) => String(c[0]).includes("FROM clients"));
    expect(lookup?.[0]).toMatch(/account_id = \$2/);
    expect(lookup?.[1]).toEqual([CLIENT_ID, mockSession.accountId]);
    expect(calls).toContain("COMMIT");
  });
});
