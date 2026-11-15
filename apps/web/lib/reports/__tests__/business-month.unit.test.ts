import { describe, expect, it, vi } from "vitest";

const { queryForSession } = vi.hoisted(() => ({ queryForSession: vi.fn() }));

vi.mock("@/lib/db", () => ({ queryForSession }));

import {
  businessMonthKey,
  sqlSafeTimeZone,
  timestampBusinessMonthExpr,
  loadBusinessTimeZone,
} from "../business-month";

describe("business month", () => {
  it("keeps 11:30 PM Eastern on the last day inside that month", () => {
    // 2026-03-31 23:30 EDT is 2026-04-01 03:30 UTC.
    expect(businessMonthKey(new Date("2026-04-01T03:30:00.000Z"), "America/New_York")).toBe("2026-03");
  });

  it("moves to the next month after midnight Eastern", () => {
    expect(businessMonthKey(new Date("2026-04-01T04:30:00.000Z"), "America/New_York")).toBe("2026-04");
  });

  it("rejects a timezone that is not safe to interpolate", () => {
    expect(sqlSafeTimeZone("America/New_York'; drop table invoices; --")).toBe("America/New_York");
    expect(sqlSafeTimeZone(null)).toBe("America/New_York");
  });

  it("converts timestamptz columns in the business zone", () => {
    expect(timestampBusinessMonthExpr("created_at", "America/New_York")).toBe(
      "to_char(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM')",
    );
    expect(timestampBusinessMonthExpr("inv.created_at", "America/Chicago")).toBe(
      "to_char(inv.created_at AT TIME ZONE 'America/Chicago', 'YYYY-MM')",
    );
  });
});

describe("loadBusinessTimeZone tenant scope", () => {
  it("reads the account zone through the session helper", async () => {
    const session = {
      userId: "00000000-0000-0000-0000-000000000001",
      accountId: "00000000-0000-0000-0000-000000000002",
      role: "owner" as const,
    };
    queryForSession.mockResolvedValueOnce([]);
    await expect(loadBusinessTimeZone(session)).resolves.toBe("America/New_York");
    expect(queryForSession.mock.calls[0][0]).toBe(session);
    expect(queryForSession.mock.calls[0][2]).toEqual([session.accountId]);
  });
});
