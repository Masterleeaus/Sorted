import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
// The caller's account-context client. logCommunication must use this, not a pool.
const db = { query: (...args: unknown[]) => mockQuery(...args) };

import { logCommunication } from "../communications-log";

describe("logCommunication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps communication fields to insert parameters", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await logCommunication(db, {
      accountId: "account-1",
      channel: "email",
      direction: "outbound",
      outcome: "sent",
      clientId: "client-1",
      bookingRequestId: "booking-1",
      jobId: "job-1",
      visitId: "visit-1",
      bodyPreview: "Preview text",
      initiatedBy: "user-1",
      externalId: "provider-1",
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain("INSERT INTO communications_log");
    expect(mockQuery.mock.calls[0][1]).toEqual([
      "account-1",
      "email",
      "outbound",
      "sent",
      "client-1",
      "booking-1",
      "job-1",
      "visit-1",
      "Preview text",
      "user-1",
      "provider-1",
    ]);
  });

  it("returns the inserted id, or null when the dedup insert returns no row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "comm-1" }] });
    await expect(
      logCommunication(db, { accountId: "account-1", channel: "sms", direction: "outbound", outcome: "sent", externalId: "e1" }),
    ).resolves.toBe("comm-1");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      logCommunication(db, { accountId: "account-1", channel: "sms", direction: "outbound", outcome: "sent", externalId: "e1" }),
    ).resolves.toBeNull();
  });

  it("defaults optional ids and metadata to null", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await logCommunication(db, {
      accountId: "account-1",
      channel: "phone",
      direction: "outbound",
      outcome: "left_voicemail",
    });

    expect(mockQuery.mock.calls[0][1]).toEqual([
      "account-1",
      "phone",
      "outbound",
      "left_voicemail",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
