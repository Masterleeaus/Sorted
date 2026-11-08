import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockSession = {
  userId: "00000000-0000-0000-0000-000000000001",
  accountId: "00000000-0000-0000-0000-000000000002",
  role: "owner" as const,
};

const mockGetSession = vi.fn(async () => mockSession);
vi.mock("@/lib/auth/session", () => ({
  getSession: () => mockGetSession(),
}));

const mockCreateZeroInteraction = vi.fn();
vi.mock("@titan-zero/titan-platform/runtime", () => ({
  createZeroInteraction: (...args: unknown[]) => mockCreateZeroInteraction(...args),
}));

const mockDispatchZeroRuntime = vi.fn(async () => ({
  accepted: true,
  run_id: "run-1",
  work_id: "work-1",
}));
vi.mock("@/lib/zero/runtime-dispatch", () => ({
  dispatchZeroRuntime: (...args: unknown[]) => mockDispatchZeroRuntime(...args),
}));

import { POST } from "../route";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/v1/zero/interactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  conversation_id: "conversation-1",
  surface: "zero",
  text: "What needs my attention?",
  client_message_id: "message-1",
};

describe("POST /api/v1/zero/interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(mockSession);
    mockDispatchZeroRuntime.mockResolvedValue({
      accepted: true,
      run_id: "run-1",
      work_id: "work-1",
    });
  });

  it("derives company_id from the authenticated server session when the client omits it", async () => {
    const response = await POST(request(baseBody));

    expect(response.status).toBe(202);
    expect(mockCreateZeroInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ company_id: mockSession.accountId }),
    );
    expect(mockDispatchZeroRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        company_id: mockSession.accountId,
        actor_id: mockSession.userId,
      }),
    );
  });

  it("rejects a conflicting legacy client company_id instead of using it", async () => {
    const response = await POST(
      request({
        ...baseBody,
        company_id: "00000000-0000-0000-0000-000000000099",
      }),
    );

    expect(response.status).toBe(403);
    expect(mockCreateZeroInteraction).not.toHaveBeenCalled();
    expect(mockDispatchZeroRuntime).not.toHaveBeenCalled();
  });

  it("accepts a matching legacy company_id but still dispatches with authenticated scope", async () => {
    const response = await POST(
      request({
        ...baseBody,
        company_id: mockSession.accountId,
      }),
    );

    expect(response.status).toBe(202);
    expect(mockDispatchZeroRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ company_id: mockSession.accountId }),
    );
  });
});
