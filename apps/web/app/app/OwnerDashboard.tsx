import Link from "next/link";
import type { Route } from "next";
import { TitanZeroChat } from "@/components/TitanZeroChat";
import type { CommandVisit } from "./DashboardWidgets";
import type { NeedsAttentionItem } from "@/lib/attention/load-needs-attention";
import { formatBusinessTime } from "@/lib/time/business-tz";

export type FieldOpsSnapshot = {
  total: number;
  scheduled: number;
  arrived: number;
  inProgress: number;
  completed: number;
  fieldWorkers: number;
};

const tabs = [
  { label: "Risk", href: "/app" },
  { label: "All jobs", href: "/app/jobs" },
  { label: "Schedule", href: "/app/schedule" },
  { label: "Work orders", href: "/app/work-orders" },
  { label: "Visits", href: "/app/visits" },
  { label: "Resources", href: "/app/workforce" },
];

export function OwnerDashboard({ attentionItems, tomorrowJobs, ops }: {
  attentionItems: NeedsAttentionItem[];
  tomorrowJobs: CommandVisit[];
  ops: FieldOpsSnapshot;
}) {
  const active = ops.arrived + ops.inProgress;
  return (
    <div className="tf-reference-ui">
      <div className="tf-topline"><span className="tf-zero-orb" /> <span>Zero <strong className="tf-green">• Ready</strong></span><span className="tf-topline-right">{ops.fieldWorkers} field workers · {active} active visits</span></div>
      <header className="tf-heading"><div><span className="tf-eyebrow">TITAN FIELD · OPERATIONS</span><h1>Jobs</h1></div><Link className="tf-primary-action" href={"/app/jobs/new" as Route}>＋ New job</Link></header>
      <nav className="tf-tabs" aria-label="Operations sections">{tabs.map((tab, index) => <Link key={tab.href} className={index === 0 ? "tf-tab tf-tab-active" : "tf-tab"} href={tab.href as Route}>{tab.label}</Link>)}</nav>
      <div className="tf-layout">
        <aside className="tf-brief" aria-label="Operational summary">
          <h2>Live operations</h2>
          <Link className="tf-brief-alert tf-brief-alert-red" href={"/app" as Route}><strong>{attentionItems.length} need attention</strong><span>Review operational exceptions</span></Link>
          <Link className="tf-brief-alert tf-brief-alert-amber" href={"/app/schedule" as Route}><strong>{ops.scheduled} scheduled</strong><span>Visits awaiting arrival</span></Link>
          <div className="tf-stat-grid">
            <Link className="tf-stat tf-stat-red" href={"/app" as Route}><b>{attentionItems.length}</b><span>items at risk</span></Link>
            <Link className="tf-stat tf-stat-orange" href={"/app/workforce" as Route}><b>{ops.fieldWorkers}</b><span>field workers</span></Link>
            <Link className="tf-stat tf-stat-yellow" href={"/app/visits" as Route}><b>{active}</b><span>active visits</span></Link>
            <Link className="tf-stat tf-stat-green" href={"/app/jobs" as Route}><b>{ops.completed}</b><span>completed</span></Link>
          </div>
        </aside>
        <main className="tf-workspace">
          <div className="tf-section-head"><h2>Needs attention</h2><span>{attentionItems.length} open</span></div>
          <div className="tf-risk-list">
            {attentionItems.length ? attentionItems.map((item, index) => (
              <Link className={`tf-risk-row tf-risk-${index === 0 ? "red" : index === 1 ? "orange" : "yellow"}`} key={`${item.href}-${item.label}`} href={item.href as Route}>
                <span className="tf-risk-icon" aria-hidden="true">{index === 0 ? "!" : index === 1 ? "↗" : "◷"}</span>
                <span className="tf-risk-content"><strong>{item.action}</strong><small>{item.detail}</small></span>
                <span className="tf-risk-cta">Review →</span>
              </Link>
            )) : <div className="tf-all-clear">✓ No open operational exceptions.</div>}
          </div>
          <div className="tf-section-head tf-upcoming-head"><h2>Upcoming visits</h2><Link href={"/app/schedule" as Route}>Open schedule →</Link></div>
          <div className="tf-risk-list">
            {tomorrowJobs.length ? tomorrowJobs.slice(0, 5).map((job) => <Link className="tf-risk-row tf-risk-green" key={job.id} href={(job.visit_id ? `/app/visits/${job.visit_id}` : `/app/jobs/${job.id}`) as Route}><span className="tf-risk-icon" aria-hidden="true">✓</span><span className="tf-risk-content"><strong>{job.title}</strong><small>{job.client_name || job.property_address || "Field work"} · {job.scheduled_start ? formatBusinessTime(job.scheduled_start) : "Time not set"}</small></span><span className="tf-risk-cta">Open →</span></Link>) : <div className="tf-all-clear">No upcoming visits found for tomorrow.</div>}
          </div>
        </main>
      </div>
      <div className="tf-assistant"><TitanZeroChat compact pulse={{ attention: attentionItems.length, todayJobs: ops.total, activeWorkers: ops.fieldWorkers }} /></div>
    </div>
  );
}
