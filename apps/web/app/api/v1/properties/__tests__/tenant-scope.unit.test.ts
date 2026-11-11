import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockSession = {
  userId: "00000000-0000-0000-0000-000000000001",
  accountId: "00000000-0000-0000-0000-000000000002",
  role: "owner" as "owner" | "admin" | "tech",
  traceId: "00000000-0000-0000-0000-000000000099",
};

vi.mock("@/lib/auth/middleware", () => ({
  withAuth: (handler: Function) => (request: NextRequest) => handler(request, mockSession),
  withRole: (_roles: string[], handler: Function) => (request: NextRequest) => handler(request, mockSession),
}));

const mockClientQuery = vi.fn();
const mockWithDbSession = vi.fn();

vi.mock("@/lib/db", () => ({
  withDbSession: (session: unknown, fn: (client: unknown) => Promise<unknown>) =>
    mockWithDbSession(session, fn),
  getPool: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import { GET as listProperties } from "../route";
import { GET as getProperty } from "../[id]/route";
import { GET as listIssues } from "../[id]/issues/route";
import { GET as listNotes } from "../[id]/notes/route";
import { GET as listVaultItems } from "../[id]/vault-items/route";

const PROPERTY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BASE = "http://localhost:3000/api/v1/properties";

function get(url: string): NextRequest {
  return new NextRequest(url, { method: "GET" });
}

/** Every SQL statement a route ran must be scoped to the session's account. */
function expectAccountScoped() {
  expect(mockWithDbSession).toHaveBeenCalled();
  for (const [, fn] of mockWithDbSession.mock.calls) {
    expect(fn).toBeTypeOf("function");
  }
  for (const [sql, params] of mockClientQuery.mock.calls) {
    expect(String(sql)).toContain("account_id");
    expect(params).toContain(mockSession.accountId);
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  mockWithDbSession.mockImplementation((_session: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: mockClientQuery })
  );
});

describe("tenant scoping: properties routes", () => {
  it("GET /properties runs its query in the caller's session and filters by account", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [{ id: PROPERTY_ID }] });

    const res = await listProperties(get(`${BASE}?q=main`));

    expect(res.status).toBe(200);
    expect(mockWithDbSession.mock.calls[0][0]).toBe(mockSession);
    expect((await res.json()).data).toEqual([{ id: PROPERTY_ID }]);
    expectAccountScoped();
  });

  it("GET /properties/[id] runs in the caller's session and returns 404 for another account's id", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const res = await getProperty(get(`${BASE}/${PROPERTY_ID}`));

    expect(res.status).toBe(404);
    expect(mockWithDbSession.mock.calls[0][0]).toBe(mockSession);
    expectAccountScoped();
  });

  it("GET /properties/[id]/issues checks ownership and lists issues inside the session", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: PROPERTY_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: "issue-1" }] });

    const res = await listIssues(get(`${BASE}/${PROPERTY_ID}/issues`));

    expect(res.status).toBe(200);
    expect(mockWithDbSession.mock.calls[0][0]).toBe(mockSession);
    expect(mockClientQuery).toHaveBeenCalledTimes(2);
    expectAccountScoped();
  });

  it("GET /properties/[id]/notes returns 404 without listing notes when the property is not in the account", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const res = await listNotes(get(`${BASE}/${PROPERTY_ID}/notes`));

    expect(res.status).toBe(404);
    expect(mockClientQuery).toHaveBeenCalledTimes(1);
    expectAccountScoped();
  });

  it("GET /properties/[id]/vault-items lists items inside the session", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: PROPERTY_ID }] })
      .mockResolvedValueOnce({ rows: [{ id: "item-1" }] });

    const res = await listVaultItems(get(`${BASE}/${PROPERTY_ID}/vault-items`));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([{ id: "item-1" }]);
    expect(mockWithDbSession.mock.calls[0][0]).toBe(mockSession);
    expectAccountScoped();
  });
});
