import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
const mockLogCommunication = vi.fn();
// The caller's account-context client. The helpers must use it, not a pool.
const db = { query: (...args: unknown[]) => mockQuery(...args) };

vi.mock("@/lib/communications-log", () => ({
  logCommunication: (...args: unknown[]) => mockLogCommunication(...args),
}));

describe("logOutboundSms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes outbound sms via logCommunication", async () => {
    mockLogCommunication.mockResolvedValue("comm-1");
    const { logOutboundSms } = await import("../outbound");
    const id = await logOutboundSms(db, {
      accountId: "acct",
      clientId: "client",
      jobId: "job",
      bodyPreview: "Hello",
      outcome: "sent",
      externalId: "msg-1",
      initiatedBy: "user-1",
    });
    expect(id).toBe("comm-1");
    expect(mockLogCommunication).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        channel: "sms",
        direction: "outbound",
        outcome: "sent",
        bodyPreview: "Hello",
        externalId: "msg-1",
      })
    );
  });
});

describe("updateOutboundSmsOutcome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when a row was updated", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: "comm-1" }] });
    const { updateOutboundSmsOutcome } = await import("../outbound");
    const ok = await updateOutboundSmsOutcome(db, "acct", "msg-1", "delivered");
    expect(ok).toBe(true);
    expect(mockQuery.mock.calls[0][0]).toMatch(/UPDATE communications_log/i);
  });

  it("returns false when no row matched", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { updateOutboundSmsOutcome } = await import("../outbound");
    expect(await updateOutboundSmsOutcome(db, "acct", "missing", "failed")).toBe(false);
  });
});
