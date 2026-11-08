import { describe, expect, it, vi, beforeEach } from "vitest";

const { queryForSession } = vi.hoisted(() => ({ queryForSession: vi.fn() }));

vi.mock("@/lib/db", () => ({
  queryForSession,
  getPool: vi.fn(),
}));

import { jobPricingModeFromSources, resolveJobPricingMode } from "../prefill-from-job";

beforeEach(() => {
  queryForSession.mockReset();
});

describe("jobPricingModeFromSources", () => {
  it("defaults a job with no estimate and no booking to hourly (quick-book)", () => {
    expect(jobPricingModeFromSources(null, null)).toBe("hourly_internal");
  });

  it("uses the approved estimate mode when present", () => {
    expect(jobPricingModeFromSources("hourly_internal", null)).toBe("hourly_internal");
    expect(jobPricingModeFromSources("flat_rate", "hourly_internal")).toBe("flat_rate");
  });

  it("falls back to the booking request mode when there is no estimate", () => {
    expect(jobPricingModeFromSources(null, "hourly_internal")).toBe("hourly_internal");
    expect(jobPricingModeFromSources(null, "flat_rate")).toBe("flat_rate");
  });

  it("returns null for an unrecognized mode so callers do not guess", () => {
    expect(jobPricingModeFromSources("something_else", null)).toBeNull();
  });

  it("does not treat an undecided booking (pricing_mode NULL) as a quick job", () => {
    expect(jobPricingModeFromSources(null, null, { hasBooking: true })).toBeNull();
  });

  it("still uses an explicit booking mode when a booking exists", () => {
    expect(
      jobPricingModeFromSources(null, "hourly_internal", { hasBooking: true }),
    ).toBe("hourly_internal");
    expect(jobPricingModeFromSources(null, "flat_rate", { hasBooking: true })).toBe(
      "flat_rate",
    );
  });

  it("uses the job's stored mode first so driveway T&M cannot become a bid", () => {
    expect(
      jobPricingModeFromSources("flat_rate", null, { jobPricingMode: "hourly_internal" }),
    ).toBe("hourly_internal");
    expect(
      jobPricingModeFromSources(null, null, {
        hasBooking: true,
        jobPricingMode: "hourly_internal",
      }),
    ).toBe("hourly_internal");
  });
});

describe("resolveJobPricingMode tenant scope", () => {
  it("reads through the session helper so account context is set", async () => {
    const session = {
      userId: "00000000-0000-0000-0000-000000000001",
      accountId: "00000000-0000-0000-0000-000000000002",
      role: "owner" as const,
    };
    queryForSession.mockResolvedValueOnce([]);
    await expect(resolveJobPricingMode(session, "job-1")).resolves.toBe("hourly_internal");
    expect(queryForSession).toHaveBeenCalledTimes(1);
    const [calledSession, sql, params] = queryForSession.mock.calls[0];
    expect(calledSession).toBe(session);
    expect(String(sql)).toContain("account_id = $2");
    expect(params).toEqual(["job-1", session.accountId]);
  });
});
