import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { queryForSession, queryOneForSession } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/ui";
import { SettingsTabsClient } from "./SettingsTabsClient";
import type { TeamMember } from "./TeamPanel";
import type { LocationDayValues } from "./LocationDaySettings";

export const dynamic = "force-dynamic";

interface AccountRow extends Record<string, unknown> {
  id: string;
  name: string;
  day_review_cutoff_time: string;
  min_stop_dwell_minutes: number;
  visit_confidence_threshold: number;
  suppress_weekend_start_prompt: boolean;
  close_day_followup_hours: number | null;
  tracking_start_time: string | null;
  tracking_end_time: string | null;
  location_retention_days: number;
}

interface UserRow extends Record<string, unknown> {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: "owner" | "admin" | "tech";
  created_at: string;
}

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // EPIC-006 Phase 5: techs reach Settings for their profile + sign out. The
  // admin-only sections below (Company, Team, Tools, System Health) stay gated
  // by `isAdmin`, so a tech sees only "Your profile".

  const isAdmin = session.role === "owner" || session.role === "admin";

  const [account, users, me] = await Promise.all([
    isAdmin
      ? queryOneForSession<AccountRow>(
          session,
          `SELECT id, name,
                  day_review_cutoff_time::text, min_stop_dwell_minutes,
                  visit_confidence_threshold, suppress_weekend_start_prompt,
                  close_day_followup_hours, tracking_start_time::text, tracking_end_time::text,
                  location_retention_days
           FROM accounts WHERE id = $1`,
          [session.accountId]
        )
      : null,
    isAdmin
      ? queryForSession<UserRow>(
          session,
          `SELECT id, full_name, email, phone, role, created_at FROM users WHERE account_id = $1 ORDER BY role, full_name`,
          [session.accountId]
        )
      : [],
    queryOneForSession<UserRow>(
      session,
      `SELECT id, full_name, email, phone, role FROM users WHERE id = $1`,
      [session.userId]
    ),
  ]);

  if (!me) redirect("/login");

  const isOwner = session.role === "owner";
  const locationDay: LocationDayValues | undefined = isOwner && account
    ? {
        dayReviewCutoffTime: account.day_review_cutoff_time,
        minStopDwellMinutes: account.min_stop_dwell_minutes,
        visitConfidenceThreshold: account.visit_confidence_threshold,
        suppressWeekendStartPrompt: account.suppress_weekend_start_prompt,
        closeDayFollowupHours: account.close_day_followup_hours,
        trackingStartTime: account.tracking_start_time,
        trackingEndTime: account.tracking_end_time,
        locationRetentionDays: account.location_retention_days,
      }
    : undefined;



  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        subtitle={
          isAdmin
            ? "Titan Go, Field operations, team and system settings"
            : "Your profile and Titan Go account"
        }
      />
      <SettingsTabsClient
        role={session.role}
        userId={session.userId}
        me={me}
        hasAccount={!!account}
        users={users as TeamMember[]}
        locationDay={locationDay}
      />
    </PageContainer>
  );
}
