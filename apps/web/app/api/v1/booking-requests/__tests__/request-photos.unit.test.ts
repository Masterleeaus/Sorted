import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => ({
  current: null as null | { userId: string; accountId: string; role: "owner" | "admin" | "tech"; traceId: string },
}));
const queryMock = vi.hoisted(() => vi.fn());
const withDbSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/session", () => ({ getSession: async () => session.current }));
vi.mock("@/lib/db", () => ({ withDbSession: withDbSessionMock, getPool: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ DATABASE_URL: "postgres://unused" }) }));

import { GET } from "@/app/api/v1/booking-requests/[id]/photos/route";

const BR = "11111111-1111-4111-8111-111111111111";
const url = (id: string) => `http://localhost/api/v1/booking-requests/${id}/photos`;

describe("GET /api/v1/booking-requests/[id]/photos", () => {
  beforeEach(() => {
    queryMock.mockReset();
    withDbSessionMock.mockReset();
    withDbSessionMock.mockImplementation(async (_s: unknown, fn: (c: unknown) => unknown) => fn({ query: queryMock }));
    session.current = { userId: "u1", accountId: "acct-a", role: "owner", traceId: "t" };
  });

  it("returns linked photo metadata scoped to the session account, without a file URL", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: BR }] })
      .mockResolvedValueOnce({ rows: [
        { id: "p1", original_name: "roof.jpg", mime_type: "image/jpeg", size_bytes: 1200, created_at: "2026-11-01" },
      ] });
    const res = await GET(new NextRequest(url(BR)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).not.toHaveProperty("filename");
    expect(body.data[0]).not.toHaveProperty("url");
    const [sqlPhotos, paramsPhotos] = [queryMock.mock.calls[1][0], queryMock.mock.calls[1][1]];
    expect(String(sqlPhotos)).toContain("m.account_id = $2");
    expect(String(sqlPhotos)).toContain("br.account_id = m.account_id");
    expect(paramsPhotos).toEqual([BR, "acct-a"]);
    expect(String(queryMock.mock.calls[0][0])).toContain("account_id = $2");
  });

  it("refuses technicians", async () => {
    session.current = { userId: "u2", accountId: "acct-a", role: "tech", traceId: "t" };
    const res = await GET(new NextRequest(url(BR)));
    expect(res.status).toBe(403);
    expect(withDbSessionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the request is not in the session account", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res = await GET(new NextRequest(url(BR)));
    expect(res.status).toBe(404);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("returns 401 with no session", async () => {
    session.current = null;
    const res = await GET(new NextRequest(url(BR)));
    expect(res.status).toBe(401);
  });

  it("returns 404 for a malformed id without querying", async () => {
    const res = await GET(new NextRequest(url("not-a-uuid")));
    expect(res.status).toBe(404);
    expect(withDbSessionMock).not.toHaveBeenCalled();
  });
});
