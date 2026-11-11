/**
 * Unit tests for POST /api/v1/portal/auth/confirm. The magic link is consumed
 * through the migration 204 resolver, and the response is a redirect with a
 * session cookie only when a live sign-in link is consumed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  query: vi.fn(),
  createPortalSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ query: h.query }));
vi.mock("@/lib/portal/session", () => ({
  createPortalSession: h.createPortalSession,
  PORTAL_SESSION_COOKIE: "portal_session",
}));
vi.mock("@/lib/email/mailer", () => ({ appUrl: () => "https://app.example.test" }));

import { POST } from "../route";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const PORTAL_TOKEN = "33333333-3333-4333-8333-333333333333";

function req(body: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/portal/auth/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.createPortalSession.mockResolvedValue("session-token");
});

describe("POST /api/v1/portal/auth/confirm", () => {
  it("consumes the link through the resolver and sets a session cookie", async () => {
    h.query.mockResolvedValue([{ client_id: CLIENT, portal_token: PORTAL_TOKEN }]);
    const res = await POST(req({ token: TOKEN }));
    expect(h.query.mock.calls[0][0]).toMatch(/FROM consume_portal_magic_link\(\$1::uuid\)/);
    expect(h.query.mock.calls[0][0]).not.toMatch(/UPDATE portal_magic_links/);
    expect(h.query.mock.calls[0][1]).toEqual([TOKEN]);
    expect(h.createPortalSession).toHaveBeenCalledWith(CLIENT);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`https://app.example.test/portal/${PORTAL_TOKEN}`);
    expect(res.headers.get("set-cookie")).toContain("portal_session=session-token");
  });

  it("redirects to expired with no session when the link is used, expired or unknown", async () => {
    h.query.mockResolvedValue([]);
    const res = await POST(req({ token: TOKEN }));
    expect(res.headers.get("location")).toBe("https://app.example.test/portal/login?error=expired");
    expect(h.createPortalSession).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("redirects to invalid when no token is sent, without touching the database", async () => {
    const res = await POST(req({}));
    expect(res.headers.get("location")).toBe("https://app.example.test/portal/login?error=invalid");
    expect(h.query).not.toHaveBeenCalled();
  });
});
