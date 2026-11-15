import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildVisitTimeline } from "@ai-fsm/domain";

const { queryForSession } = vi.hoisted(() => ({ queryForSession: vi.fn() }));

vi.mock("@/lib/db", () => ({ queryForSession }));

import { groupActivitiesByVisitId, loadVisitTimeline } from "../load-visit-timeline";

beforeEach(() => {
  queryForSession.mockReset();
});

describe("groupActivitiesByVisitId", () => {
  it("groups activity rows by entity_id", () => {
    const grouped = groupActivitiesByVisitId([
      {
        id: "a1",
        entity_id: "v1",
        activity_type: "job_work",
        started_at: "2026-08-05T12:00:00.000Z",
        ended_at: "2026-08-05T13:00:00.000Z",
        note: null,
      },
      {
        id: "a2",
        entity_id: "v2",
        activity_type: "travel",
        started_at: "2026-08-05T11:00:00.000Z",
        ended_at: null,
        note: "to site",
      },
      {
        id: "a3",
        entity_id: "v1",
        activity_type: "material_run",
        started_at: "2026-08-05T14:00:00.000Z",
        ended_at: "2026-08-05T14:30:00.000Z",
        note: null,
      },
    ]);
    expect(grouped.v1).toHaveLength(2);
    expect(grouped.v2).toHaveLength(1);
    expect(grouped.v2[0].label).toBe("to site");
  });
});

describe("buildVisitTimeline integration smoke", () => {
  it("composes with grouped activities", () => {
    const grouped = groupActivitiesByVisitId([
      {
        id: "a1",
        entity_id: "v1",
        activity_type: "job_work",
        started_at: "2026-08-05T12:45:00.000Z",
        ended_at: null,
        note: null,
      },
    ]);
    const events = buildVisitTimeline({
      visit: {
        id: "v1",
        scheduled_start: "2026-08-05T12:00:00.000Z",
        arrived_at: "2026-08-05T12:40:00.000Z",
        completed_at: null,
      },
      activities: grouped.v1,
    });
    expect(events.some((e) => e.is_open)).toBe(true);
    expect(events.map((e) => e.kind)).toEqual(["scheduled", "arrived", "activity"]);
  });
});

describe("loadVisitTimeline tenant scope", () => {
  it("reads visit rows through the session helper scoped to the session account", async () => {
    const session = {
      userId: "00000000-0000-0000-0000-000000000001",
      accountId: "00000000-0000-0000-0000-000000000002",
      role: "owner" as const,
    };
    queryForSession.mockResolvedValueOnce([]);
    await expect(loadVisitTimeline(session, "visit-1")).resolves.toEqual([]);
    expect(queryForSession.mock.calls[0][0]).toBe(session);
    expect(queryForSession.mock.calls[0][2]).toEqual([session.accountId, "visit-1"]);
  });
});
