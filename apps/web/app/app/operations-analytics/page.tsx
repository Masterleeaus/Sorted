import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { queryForSession } from "@/lib/db";
import { Card, PageContainer, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

type SnapshotRow = {
  visits_30d: string;
  completed_30d: string;
  cancelled_30d: string;
  in_progress_30d: string;
  next_7d: string;
  field_workers: string;
};

type DayRow = {
  day: string;
  total: string;
  completed: string;
};

function n(value: string | null | undefined): number {
  return Number.parseInt(value ?? "0", 10) || 0;
}

export default async function OperationsAnalyticsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "tech") redirect("/app/my-work");

  const [snapshotRows, days] = await Promise.all([
    queryForSession<SnapshotRow>(
      session,
      `SELECT
        COUNT(*) FILTER (WHERE v.scheduled_start >= CURRENT_TIMESTAMP - INTERVAL '30 days')::text AS visits_30d,
        COUNT(*) FILTER (WHERE v.scheduled_start >= CURRENT_TIMESTAMP - INTERVAL '30 days' AND v.status = 'completed')::text AS completed_30d,
        COUNT(*) FILTER (WHERE v.scheduled_start >= CURRENT_TIMESTAMP - INTERVAL '30 days' AND v.status = 'cancelled')::text AS cancelled_30d,
        COUNT(*) FILTER (WHERE v.scheduled_start >= CURRENT_TIMESTAMP - INTERVAL '30 days' AND v.status IN ('arrived','in_progress'))::text AS in_progress_30d,
        COUNT(*) FILTER (WHERE v.scheduled_start >= CURRENT_TIMESTAMP AND v.scheduled_start < CURRENT_TIMESTAMP + INTERVAL '7 days' AND v.status NOT IN ('completed','cancelled'))::text AS next_7d,
        (SELECT COUNT(*)::text FROM users u WHERE u.account_id = $1 AND u.role = 'tech') AS field_workers
       FROM visits v
       WHERE v.account_id = $1`,
      [session.accountId],
    ),
    queryForSession<DayRow>(
      session,
      `SELECT
         timezone('America/New_York', scheduled_start)::date::text AS day,
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE status = 'completed')::text AS completed
       FROM visits
       WHERE account_id = $1
         AND scheduled_start >= CURRENT_TIMESTAMP - INTERVAL '6 days'
         AND scheduled_start < CURRENT_TIMESTAMP + INTERVAL '1 day'
       GROUP BY timezone('America/New_York', scheduled_start)::date
       ORDER BY day ASC`,
      [session.accountId],
    ),
  ]);

  const row = snapshotRows[0];
  const visits30 = n(row?.visits_30d);
  const completed30 = n(row?.completed_30d);
  const cancelled30 = n(row?.cancelled_30d);
  const completionRate = visits30 > 0 ? Math.round((completed30 / Math.max(1, visits30 - cancelled30)) * 100) : 0;
  const maxDay = Math.max(1, ...days.map((day) => n(day.total)));

  return (
    <PageContainer>
      <PageHeader
        title="Operations Analytics"
        subtitle="Field delivery, completion, workload and capacity signals for operational decisions."
      />

      <div className="tg-analytics-metrics">
        <Card padding="default"><span>Visits · 30 days</span><strong>{visits30}</strong><small>Scheduled field delivery</small></Card>
        <Card padding="default"><span>Completion rate</span><strong>{completionRate}%</strong><small>{completed30} completed · {cancelled30} cancelled</small></Card>
        <Card padding="default"><span>Next 7 days</span><strong>{n(row?.next_7d)}</strong><small>Open scheduled visits</small></Card>
        <Card padding="default"><span>Field team</span><strong>{n(row?.field_workers)}</strong><small>Human technicians</small></Card>
      </div>

      <div className="tg-analytics-grid">
        <Card padding="default" className="tg-analytics-card tg-analytics-card--wide">
          <div className="tg-section-heading">
            <div><span className="tg-kicker">7-DAY DELIVERY</span><h2>Work completed by day</h2><p>Relative daily volume from the live visit ledger.</p></div>
          </div>
          {days.length ? (
            <div className="tg-analytics-bars">
              {days.map((day) => {
                const total = n(day.total);
                const completed = n(day.completed);
                const width = `${Math.max(5, Math.round((total / maxDay) * 100))}%`;
                const completedWidth = total > 0 ? `${Math.round((completed / total) * 100)}%` : "0%";
                return (
                  <div key={day.day} className="tg-analytics-bar-row">
                    <time>{new Date(`${day.day}T12:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric" })}</time>
                    <div className="tg-analytics-bar-track"><span style={{ width }}><i style={{ width: completedWidth }} /></span></div>
                    <b>{completed}/{total}</b>
                  </div>
                );
              })}
            </div>
          ) : <div className="tg-empty-state"><strong>No recent visit data.</strong><span>Operational delivery trends will appear as Field work is scheduled.</span></div>}
        </Card>

        <Card padding="default" className="tg-analytics-card">
          <span className="tg-kicker">LIVE PRESSURE</span>
          <h2>{n(row?.in_progress_30d)} active visits</h2>
          <p className="tz-muted-copy">Arrived or in-progress work in the current 30-day operating window.</p>
          <div className="tg-analytics-signal">
            <span>Completion</span><strong>{completionRate >= 90 ? "Healthy" : completionRate >= 70 ? "Watch" : "Needs review"}</strong>
          </div>
        </Card>

        <Card padding="default" className="tg-analytics-card">
          <span className="tg-kicker">PREDICTIVE OPERATIONS</span>
          <h2>Signals, not authority</h2>
          <p className="tz-muted-copy">Prediction can surface workload and delivery risk early. Any response still passes the normal authority and capability rules.</p>
        </Card>
      </div>
    </PageContainer>
  );
}
