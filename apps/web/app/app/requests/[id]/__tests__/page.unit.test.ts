/**
 * Unit test for the staff booking-request page: the latest intake invite is read
 * with an account predicate taken from the staff session, not only by request id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ACCOUNT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUEST = "33333333-3333-4333-8333-333333333333";

vi.hoisted(() => {
  (globalThis as { React?: unknown }).React = {
    createElement: (type: unknown, props: unknown) => ({ type, props }),
    Fragment: "Fragment",
  };
});

const state = vi.hoisted(() => ({
  sessionAccount: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  calls: [] as { sql: string; params?: unknown[] }[],
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ userId: "u1", accountId: state.sessionAccount, role: "owner" }),
}));

vi.mock("@/lib/db", () => ({
  queryOneForSession: async (_session: unknown, sql: string, params?: unknown[]) => {
    state.calls.push({ sql, params });
    if (sql.includes("FROM booking_requests br")) {
      return {
        id: REQUEST, account_id: ACCOUNT, name: "Pat", status: "new", created_at: "2026-01-01T00:00:00Z",
        service_category: "handyman", referral_source: null, intake_metadata: {}, walkthrough_score: null,
        duplicate_candidate_ids: [], preferred_date: null, job_id: null,
      };
    }
    return null;
  },
  queryForSession: async (_session: unknown, sql: string, params?: unknown[]) => {
    state.calls.push({ sql, params });
    return [];
  },
}));

vi.mock("@/lib/intake/request-photos", () => ({ listRequestIntakePhotos: async () => [] }));
vi.mock("@/components/ui", () => ({
  PageContainer: () => null,
  PageHeader: () => null,
  Card: () => null,
  SectionHeader: () => null,
  StatusBadge: () => null,
  LinkButton: () => null,
}));
vi.mock("@/components/attention/MarkEntityAttentionRead", () => ({ MarkEntityAttentionRead: () => null }));
vi.mock("./ReviewActions", () => ({ ReviewActions: () => null }));
vi.mock("./IntakeSummary", () => ({ IntakeSummary: () => null }));

import BookingRequestDetailPage from "../page";

const run = () => BookingRequestDetailPage({ params: Promise.resolve({ id: REQUEST }) });

beforeEach(() => {
  state.sessionAccount = ACCOUNT;
  state.calls = [];
});

describe("staff booking request page", () => {
  it("reads the latest intake invite with the session account predicate", async () => {
    await run();
    const invite = state.calls.find((c) => c.sql.includes("FROM intake_invites"));
    expect(invite?.sql).toContain("account_id = $2");
    expect(invite?.params).toEqual([REQUEST, ACCOUNT]);
  });

  it("uses the signed-in account, not the request's account, for the invite read", async () => {
    state.sessionAccount = OTHER_ACCOUNT;
    await run().catch(() => undefined);
    const invite = state.calls.find((c) => c.sql.includes("FROM intake_invites"));
    expect(invite?.params).toEqual([REQUEST, OTHER_ACCOUNT]);
  });
});
