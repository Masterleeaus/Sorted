import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { queryForSession } from "@/lib/db";
import { PageContainer, PageHeader } from "@/components/ui";
import { OwnerDashboard, type FieldOpsSnapshot } from "./OwnerDashboard";
import type { CommandVisit } from "./DashboardWidgets";
import { loadNeedsAttention } from "@/lib/attention/load-needs-attention";
import { filterAttentionForSurface } from "@/lib/attention/surfaces";
import { formatBusinessDate } from "@/lib/time/business-tz";

export const dynamic = "force-dynamic";

type OpsRow = {
  total: string;
  scheduled: string;
  arrived: string;
  in_progress: string;
  completed: string;
};
type CountRow = { count: string };

function n(value: string | undefined | null): number {
  return Number.parseInt(value ?? "0", 10) || 0;
}

export default async function AppPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "tech") redirect("/app/my-work");

  const accountId = session.accountId;
  const todayLabel = formatBusinessDate(new Date(), {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const [tomorrowJobs, opsRows, workerRows, attention] = await Promise.all([
    queryForSession<CommandVisit>(
      session,
      `SELECT DISTINCT ON (j.id)
              j.id, j.title, j.status,
              c.name AS client_name,
              p.address AS property_address,
              v.id AS visit_id,
              v.scheduled_start::text AS scheduled_start,
              v.status AS visit_status,
              v.sub_status
       FROM jobs j
       LEFT JOIN clients c ON c.id = j.client_id
       LEFT JOIN properties p ON p.id = j.property_id
       LEFT JOIN visits v ON v.job_id = j.id AND v.account_id = j.account_id
       WHERE j.account_id = $1
         AND v.status IN ('scheduled','arrived','in_progress')
         AND timezone('America/New_York', v.scheduled_start)::date
           = (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date + 1
       ORDER BY j.id, v.scheduled_start ASC
       LIMIT 8`,
      [accountId],
    ),
    queryForSession<OpsRow>(
      session,
      `SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE status = 'scheduled')::text AS scheduled,
          COUNT(*) FILTER (WHERE status = 'arrived')::text AS arrived,
          COUNT(*) FILTER (WHERE status = 'in_progress')::text AS in_progress,
          COUNT(*) FILTER (WHERE status = 'completed')::text AS completed
       FROM visits
       WHERE account_id = $1
         AND timezone('America/New_York', scheduled_start)::date
           = (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date`,
      [accountId],
    ),
    queryForSession<CountRow>(
      session,
      `SELECT COUNT(*)::text AS count
         FROM users
        WHERE account_id = $1 AND role = 'tech'`,
      [accountId],
    ),
    loadNeedsAttention(session),
  ]);

  const row = opsRows[0];
  const ops: FieldOpsSnapshot = {
    total: n(row?.total),
    scheduled: n(row?.scheduled),
    arrived: n(row?.arrived),
    inProgress: n(row?.in_progress),
    completed: n(row?.completed),
    fieldWorkers: n(workerRows[0]?.count),
  };

  const fieldAttention = filterAttentionForSurface(attention.items, "today");

  return (
    <PageContainer>
      <div className="tz-desktop-page-head">
        <PageHeader
          title="Command"
          subtitle={`${todayLabel} · Run the work.`}
        />
      </div>
      <OwnerDashboard
        attentionItems={fieldAttention}
        tomorrowJobs={tomorrowJobs}
        ops={ops}
      />
    </PageContainer>
  );
}
