import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockSession = {
  userId: "00000000-0000-0000-0000-000000000001",
  accountId: "00000000-0000-0000-0000-000000000002",
  role: "owner" as "owner" | "admin" | "tech",
  traceId: "00000000-0000-0000-0000-000000000099",
};

vi.mock("../../../../../lib/auth/middleware", () => ({
  withAuth: (handler: Function) => (request: NextRequest) => handler(request, mockSession),
  withRole: (_roles: string[], handler: Function) => (request: NextRequest) => handler(request, mockSession),
}));

const mockClientQuery = vi.fn();
const mockWithDbSession = vi.fn();
const mockGetPool = vi.fn();
const mockAppendAuditLog = vi.fn();

vi.mock("../../../../../lib/db", () => ({
  withDbSession: (session: unknown, fn: (client: unknown) => Promise<unknown>) =>
    mockWithDbSession(session, fn),
  getPool: () => mockGetPool(),
}));

vi.mock("../../../../../lib/db/audit", () => ({
  appendAuditLog: (...args: unknown[]) => mockAppendAuditLog(...args),
}));

vi.mock("../../../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

vi.mock("../../../../../lib/email/mailer", () => ({
  sendEmail: vi.fn(),
  isEmailConfigured: () => false,
}));

vi.mock("../../../../../lib/communications-log", () => ({
  logCommunication: vi.fn(),
}));

import { GET as listMedia } from "../[id]/media/route";
import { DELETE as deleteMedia } from "../[id]/media/[mediaId]/route";
import { GET as getMediaImage } from "../[id]/media/[mediaId]/image/route";
import { GET as listParts } from "../[id]/parts/route";
import { PATCH as patchPart } from "../[id]/parts/[partId]/route";
import { POST as onMyWay } from "../[id]/on-my-way/route";

const VISIT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const MEDIA_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const PART_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const BASE = `http://localhost:3000/api/v1/visits/${VISIT_ID}`;

function req(url: string, init?: { method?: string; body?: unknown }): NextRequest {
  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockSession.role = "owner";
  mockWithDbSession.mockImplementation((_session: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: mockClientQuery })
  );
});

describe("tenant scoping: visit media and parts routes", () => {
  it("GET /visits/[id]/media checks the visit and lists media inside the session, account-scoped", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: VISIT_ID, assigned_user_id: null }] })
      .mockResolvedValueOnce({ rows: [{ id: MEDIA_ID }] });

    const res = await listMedia(req(`${BASE}/media`));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([{ id: MEDIA_ID }]);
    expect(mockWithDbSession.mock.calls[0][0]).toBe(mockSession);
    for (const [sql, params] of mockClientQuery.mock.calls) {
      expect(String(sql)).toContain("account_id");
      expect(params).toContain(mockSession.accountId);
    }
  });

  it("GET /visits/[id]/media returns 403 for a tech on an unassigned visit without listing media", async () => {
    mockSession.role = "tech";
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: VISIT_ID, assigned_user_id: "someone-else" }] });

    const res = await listMedia(req(`${BASE}/media`));

    expect(res.status).toBe(403);
    expect(mockClientQuery).toHaveBeenCalledTimes(1);
  });

  it("GET /visits/[id]/parts returns 404 when the visit is not in the account", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const res = await listParts(req(`${BASE}/parts`));

    expect(res.status).toBe(404);
    expect(mockWithDbSession.mock.calls[0][0]).toBe(mockSession);
    expect(String(mockClientQuery.mock.calls[0][0])).toContain("account_id");
    expect(mockClientQuery.mock.calls[0][1]).toContain(mockSession.accountId);
  });

  it("GET /visits/[id]/media/[mediaId]/image returns 404 when the media row is not in the account", async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ id: VISIT_ID, assigned_user_id: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await getMediaImage(req(`${BASE}/media/${MEDIA_ID}/image`));

    expect(res.status).toBe(404);
    expect(mockWithDbSession).toHaveBeenCalledTimes(2);
    const mediaCall = mockClientQuery.mock.calls[1];
    expect(String(mediaCall[0])).toContain("account_id");
    expect(mediaCall[1]).toContain(mockSession.accountId);
  });

  it("DELETE /visits/[id]/media/[mediaId] stops before opening a write connection when the visit is not in the account", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const res = await deleteMedia(req(`${BASE}/media/${MEDIA_ID}`, { method: "DELETE" }));

    expect(res.status).toBe(404);
    expect(mockGetPool).not.toHaveBeenCalled();
    expect(mockClientQuery.mock.calls[0][1]).toContain(mockSession.accountId);
  });

  it("PATCH /visits/[id]/parts/[partId] stops when the visit is not in the account", async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    const res = await patchPart(req(`${BASE}/parts/${PART_ID}`, { method: "PATCH", body: { name: "x" } }));

    expect(res.status).toBe(404);
    expect(mockWithDbSession.mock.calls[0][0]).toBe(mockSession);
    expect(mockClientQuery.mock.calls[0][1]).toContain(mockSession.accountId);
    expect(mockGetPool).not.toHaveBeenCalled();
  });

  it("POST /visits/[id]/on-my-way reads the visit and writes the audit row in account-scoped sessions", async () => {
    mockClientQuery.mockResolvedValueOnce({
      rows: [{
        id: VISIT_ID,
        account_id: mockSession.accountId,
        status: "scheduled",
        scheduled_start: new Date().toISOString(),
        scheduled_end: new Date().toISOString(),
        job_id: "job-1",
        job_title: "Fix roof",
        client_id: "client-1",
        client_name: "Pat",
        client_email: null,
        property_address: null,
        tech_name: null,
      }],
    });

    const res = await onMyWay(req(`${BASE}/on-my-way`, { method: "POST" }));

    expect(res.status).toBe(200);
    expect(mockWithDbSession).toHaveBeenCalledTimes(2);
    for (const [session] of mockWithDbSession.mock.calls) {
      expect(session).toBe(mockSession);
    }
    expect(String(mockClientQuery.mock.calls[0][0])).toContain("v.account_id = $3");
    expect(mockClientQuery.mock.calls[0][1]).toContain(mockSession.accountId);
    expect(mockAppendAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ query: mockClientQuery }),
      expect.objectContaining({ account_id: mockSession.accountId, entity_type: "on_my_way" }),
    );
  });
});
