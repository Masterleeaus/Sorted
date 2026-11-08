import { redirect } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { getSession } from "@/lib/auth/session";
import { queryForSession } from "@/lib/db";
import { Card, PageContainer, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

type AssetRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  homebox_item_id: string;
  cached_name: string | null;
  cached_location: string | null;
  status: string;
  created_at: string;
};

export default async function AssetsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "tech") redirect("/app/my-work");

  const assets = await queryForSession<AssetRow>(
    session,
    `SELECT id, entity_type, entity_id, homebox_item_id,
            cached_name, cached_location, status, created_at::text
       FROM asset_links
      WHERE account_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
    [session.accountId],
  );

  const linkedJobs = new Set(assets.filter((asset) => asset.entity_type === "job").map((asset) => asset.entity_id)).size;
  const linkedVisits = new Set(assets.filter((asset) => asset.entity_type === "visit").map((asset) => asset.entity_id)).size;
  const attention = assets.filter((asset) => !["active", "available", "linked", "ready"].includes(asset.status.toLowerCase())).length;

  return (
    <PageContainer>
      <PageHeader
        title="Assets"
        subtitle="Equipment custody and readiness attached to real Field work"
        actions={<Link href={"/app/jobs" as Route} className="tz-secondary-link">Open jobs →</Link>}
      />

      <section className="tg-assets-hero">
        <div>
          <span className="tg-kicker">ASSETS & SUPPLY</span>
          <h2>Know what is allocated, where it is, and which work depends on it.</h2>
          <p>
            Titan Field keeps equipment links attached to Jobs and Visits so custody and readiness stay traceable through execution and evidence.
          </p>
        </div>
        <div className="tg-assets-metrics">
          <Card padding="default"><span>Equipment links</span><strong>{assets.length}</strong><small>Live Field associations</small></Card>
          <Card padding="default"><span>Jobs</span><strong>{linkedJobs}</strong><small>With linked equipment</small></Card>
          <Card padding="default"><span>Visits</span><strong>{linkedVisits}</strong><small>With linked equipment</small></Card>
          <Card padding="default"><span>Needs review</span><strong>{attention}</strong><small>Status outside ready states</small></Card>
        </div>
      </section>

      <div className="tg-section-heading tg-assets-heading">
        <div>
          <span className="tg-kicker">LINKED EQUIPMENT</span>
          <h2>Field asset activity</h2>
          <p>Open the Job or Visit to change an equipment link. This keeps asset changes inside the work context that owns them.</p>
        </div>
      </div>

      <div className="tz-record-list tg-asset-record-list">
        {assets.length === 0 ? (
          <Card padding="default">
            <div className="tz-empty-compact">
              <strong>No equipment is linked to Field work yet.</strong>
              <span>Open a Job or Visit and attach equipment from the asset register when it becomes part of execution.</span>
            </div>
          </Card>
        ) : assets.map((asset) => {
          const href = asset.entity_type === "visit"
            ? `/app/visits/${asset.entity_id}`
            : `/app/jobs/${asset.entity_id}`;
          return (
            <Link key={asset.id} href={href as Route} className="tz-record-row tg-asset-row">
              <span className="tz-record-row__icon tg-asset-row__icon">◇</span>
              <span className="tz-record-row__body">
                <strong>{asset.cached_name || "Equipment"}</strong>
                <small>{asset.cached_location || "No stored location"} · linked to {asset.entity_type}</small>
              </span>
              <span className={`tz-status-dot tz-status-dot--${asset.status}`}>{asset.status.replaceAll("_", " ")}</span>
            </Link>
          );
        })}
      </div>

      <div className="tg-governance-strip">
        <strong>Asset state stays attached to work evidence.</strong>
        <span>Equipment identity or location does not grant authority. Field actions still follow the Job, Visit and user capability boundaries.</span>
      </div>
    </PageContainer>
  );
}
