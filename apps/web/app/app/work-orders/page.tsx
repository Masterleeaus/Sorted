import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { queryForSession } from "@/lib/db";
import { canCreateEstimates } from "@/lib/auth/permissions";
import { WORK_ORDER_UI_STATUSES, WORK_ORDER_STATUS_LABELS } from "@ai-fsm/domain";
import { formatBusinessDate } from "@/lib/time/business-tz";
import {
  Badge,
  EmptyState,
  FilterBar,
  ItemCard,
  LinkButton,
  PageContainer,
  PageHeader,
} from "@/components/ui";
import type { FilterDef } from "@/components/ui";

export const dynamic = "force-dynamic";

type WorkOrderRow = {
  id: string;
  title: string;
  status: string;
  total_cents: number;
  client_name: string | null;
  property_address: string | null;
  job_title: string | null;
  job_number: string | null;
  completed_at: string | null;
  created_at: string;
  visit_count: number;
  open_visit_count: number;
};

const FILTERS: FilterDef[] = [
  { name: "q", type: "text", label: "Search", placeholder: "Work order, job, client or site…" },
  {
    name: "status",
    type: "select",
    label: "Status",
    options: WORK_ORDER_UI_STATUSES.map((status) => ({
      value: status,
      label: WORK_ORDER_STATUS_LABELS[status],
    })),
  },
];

function money(cents: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format((Number(cents) || 0) / 100);
}

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canCreateEstimates(session.role)) redirect("/app/my-work");

  const { q = "", status = "" } = await searchParams;
  const search = q.trim().toLowerCase();
  const selectedStatus = (WORK_ORDER_UI_STATUSES as readonly string[]).includes(status) ? status : "";

  const params: unknown[] = [session.accountId];
  const where = ["w.account_id = $1"];
  let param = 2;

  if (search) {
    where.push(`(
      LOWER(w.title) LIKE $${param}
      OR LOWER(COALESCE(c.name, '')) LIKE $${param}
      OR LOWER(COALESCE(p.address, '')) LIKE $${param}
      OR LOWER(COALESCE(j.title, '')) LIKE $${param}
      OR LOWER(COALESCE(j.job_number, '')) LIKE $${param}
    )`);
    params.push(`%${search}%`);
    param += 1;
  }

  if (selectedStatus) {
    where.push(`w.status = $${param}`);
    params.push(selectedStatus);
  }

  const rows = await queryForSession<WorkOrderRow>(
    session,
    `SELECT
       w.id,
       w.title,
       w.status,
       w.total_cents,
       c.name AS client_name,
       p.address AS property_address,
       j.title AS job_title,
       j.job_number,
       w.completed_at::text,
       w.created_at::text,
       COUNT(v.id)::int AS visit_count,
       COUNT(v.id) FILTER (WHERE v.status NOT IN ('completed','cancelled'))::int AS open_visit_count
     FROM work_orders w
     LEFT JOIN clients c ON c.id = w.client_id
     LEFT JOIN properties p ON p.id = w.property_id
     LEFT JOIN jobs j ON j.id = w.job_id
     LEFT JOIN visits v ON v.work_order_id = w.id AND v.account_id = w.account_id
     WHERE ${where.join(" AND ")}
     GROUP BY w.id, c.name, p.address, j.title, j.job_number
     ORDER BY
       CASE WHEN w.status IN ('completed','cancelled') THEN 1 ELSE 0 END,
       w.created_at DESC
     LIMIT 200`,
    params,
  );

  const activeCount = rows.filter((row) => !["completed", "cancelled"].includes(row.status)).length;

  return (
    <PageContainer>
      <PageHeader
        title="Work Orders"
        subtitle={`${activeCount} active · ${rows.length} shown · execution units between a Job and its field Visits`}
        actions={<LinkButton href="/app/work-orders/new" variant="primary" size="sm">+ Work Order</LinkButton>}
      />

      <div className="tg-work-order-intro">
        <div>
          <span className="tg-kicker">FIELD EXECUTION</span>
          <strong>Keep scope, completion criteria and field days together.</strong>
          <p>A Work Order carries the bounded scope that Visits execute. Open it to schedule field days, review materials, completion evidence and status.</p>
        </div>
        <div className="tg-work-order-intro__stats">
          <span><b>{activeCount}</b> Active</span>
          <span><b>{rows.reduce((sum, row) => sum + row.open_visit_count, 0)}</b> Open visits</span>
        </div>
      </div>

      <FilterBar
        filters={FILTERS}
        baseHref="/app/work-orders"
        currentValues={{ q, status: selectedStatus }}
      />

      {rows.length === 0 ? (
        <EmptyState
          title={search || selectedStatus ? "No matching work orders" : "No work orders yet"}
          description={search || selectedStatus ? "Clear the filters or search another job, client or site." : "Create a Work Order when a Job needs a defined execution scope for one or more field visits."}
          action={<LinkButton href="/app/work-orders/new" variant="primary">+ Work Order</LinkButton>}
        />
      ) : (
        <div className="tg-work-order-list">
          {rows.map((row) => (
            <ItemCard
              key={row.id}
              href={`/app/work-orders/${row.id}`}
              title={row.title}
              titleBadge={<Badge className={`tg-work-order-status tg-work-order-status--${row.status}`}>{WORK_ORDER_STATUS_LABELS[row.status as keyof typeof WORK_ORDER_STATUS_LABELS] ?? row.status.replaceAll("_", " ")}</Badge>}
              meta={
                <div className="tg-work-order-meta">
                  <span>{row.job_number ? `${row.job_number} · ` : ""}{row.job_title ?? "Standalone work order"}</span>
                  <span>{row.client_name ?? "No client"}{row.property_address ? ` · ${row.property_address}` : ""}</span>
                  <span>{row.visit_count} visit{row.visit_count === 1 ? "" : "s"} · {row.open_visit_count} open</span>
                  {row.total_cents > 0 ? <span>{money(row.total_cents)} materials/scope value</span> : null}
                  <span>Created {formatBusinessDate(row.created_at, { year: undefined })}</span>
                </div>
              }
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
