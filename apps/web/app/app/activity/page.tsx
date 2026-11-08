import Link from "next/link";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { loadNeedsAttention } from "@/lib/attention/load-needs-attention";
import { queryForSession } from "@/lib/db";

export const dynamic = "force-dynamic";
type RecentVisit = { id: string; job_id: string; title: string; status: string; scheduled_start: string; client_name: string | null };
export default async function ActivityPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const [attention, visits] = await Promise.all([
    loadNeedsAttention(session),
    queryForSession<RecentVisit>(session, `SELECT v.id, v.job_id, j.title, v.status, v.scheduled_start::text AS scheduled_start, c.name AS client_name FROM visits v JOIN jobs j ON j.id = v.job_id AND j.account_id = v.account_id LEFT JOIN clients c ON c.id = j.client_id AND c.account_id = j.account_id WHERE v.account_id = $1 ORDER BY v.scheduled_start DESC LIMIT 12`, [session.accountId]),
  ]);
  return <div className="tf-reference-ui tf-workspace"><div className="tf-topline"><span className="tf-zero-orb"/> Zero <b className="tf-green">• Ready</b></div><div className="tf-heading"><h1>Activity</h1><Link href="/app/day-review">Notifications →</Link></div><nav className="tf-tabs" aria-label="Activity views"><span className="tf-tab tf-tab-active">Messages</span><Link className="tf-tab" href="/app/day-review">Notifications</Link></nav><p className="tf-feed-hint">Select an item to open its record. No activity is deleted or delegated without confirmation.</p><div className="tf-feed">
    {attention.items.map((item, i) => <Link key={`${item.href}-${i}`} href={item.href as Route} className={`tf-feed-item tf-feed-${item.tone === "danger" ? "red" : item.tone === "warning" ? "yellow" : "orange"}`}><span className="tf-feed-symbol">{item.tone === "danger" ? "!" : "◷"}</span><span className="tf-feed-copy"><strong>{item.action}</strong><small>{item.detail}</small><em>{item.count} item{item.count === 1 ? "" : "s"} · {item.priorityReason}</em></span><span className="tf-feed-open">Review →</span></Link>)}
    {visits.map(v => <Link key={v.id} href={`/app/visits/${v.id}` as Route} className={`tf-feed-item tf-feed-${v.status === "completed" ? "green" : "blue"}`}><span className="tf-feed-symbol">{v.status === "completed" ? "✓" : "◷"}</span><span className="tf-feed-copy"><strong>{v.title} · {v.status.replaceAll("_", " ")}</strong><small>{v.client_name || "Field visit"} · {new Date(v.scheduled_start).toLocaleString("en-AU", {dateStyle:"medium",timeStyle:"short"})}</small></span><span className="tf-feed-open">Open →</span></Link>)}
    {!attention.items.length && !visits.length && <div className="tf-all-clear">No recent operational activity.</div>}
  </div></div>;
}
