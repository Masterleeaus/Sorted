/**
 * Builder preview is read-only and authority-neutral. These server projection
 * executors currently read the native Titan FSM store. Preserve native FSM
 * ownership, but keep Builder coupled to bounded Titan Domain/Business Reality
 * contracts rather than persistence details so optional providers remain possible.
 * Historical "workcore" naming is an internal donor label, not a canonical owner.
 */
import { portableQuery } from "@/lib/db/portable";
import type { InterfaceContext } from "@titan-zero/titan-platform/interface-runtime";
import {
  createCapabilityOwnedBuilderProjectionProvider,
  type BuilderCapabilityProjectionExecutor,
  type BuilderCapabilityProjectionQuery,
} from "@titan-zero/titan-platform/titan-builder";

type Row = Record<string, unknown>;
const cents = (value: unknown) => Number(value ?? 0) / 100;
const iso = (value: unknown) => value == null ? null : new Date(String(value)).toISOString();

function assertQuery(query: BuilderCapabilityProjectionQuery, context: InterfaceContext) {
  if (query.company_id !== context.company_id) throw new Error("builder_server_projection_company_mismatch");
  if (query.surface !== context.product_surface) throw new Error("builder_server_projection_surface_mismatch");
  if (!query.read_only || query.purpose !== "builder-preview") throw new Error("builder_server_projection_not_read_only");
}

async function workCoreRows(query: BuilderCapabilityProjectionQuery): Promise<readonly Row[] | null> {
  switch (query.contract) {
    case "crm.customer.work-orders": {
      const rows = await portableQuery<Row>(
        `SELECT j.id, j.title, j.status, j.scheduled_start, j.job_type
         FROM jobs j WHERE j.account_id = $1 ORDER BY j.created_at DESC LIMIT 6`, [query.company_id]);
      return rows.map(r => ({ id:r.id, reference:r.title ?? r.id, status:r.status, scheduled_at:iso(r.scheduled_start), service_summary:r.job_type ?? r.title }));
    }
    case "crm.customer.bookings": {
      const rows = await portableQuery<Row>(
        `SELECT v.id, v.status, v.scheduled_start, j.title, p.address_line1, p.city
         FROM visits v LEFT JOIN jobs j ON j.id=v.job_id AND j.account_id=v.account_id
         LEFT JOIN properties p ON p.id=j.property_id AND p.account_id=j.account_id
         WHERE v.account_id=$1 ORDER BY v.scheduled_start DESC LIMIT 6`, [query.company_id]);
      return rows.map(r => ({ id:r.id, status:r.status, starts_at:iso(r.scheduled_start), service:r.title, location_summary:[r.address_line1,r.city].filter(Boolean).join(", ") }));
    }
    case "crm.field.assigned-work": {
      const rows = await portableQuery<Row>(
        `SELECT j.id, j.title, j.status, j.scheduled_start, c.name AS customer_name, p.address_line1, p.city
         FROM jobs j LEFT JOIN clients c ON c.id=j.client_id AND c.account_id=j.account_id
         LEFT JOIN properties p ON p.id=j.property_id AND p.account_id=j.account_id
         WHERE j.account_id=$1 ORDER BY j.created_at DESC LIMIT 6`, [query.company_id]);
      return rows.map(r => ({ id:r.id, reference:r.title ?? r.id, status:r.status, scheduled_at:iso(r.scheduled_start), site_summary:[r.address_line1,r.city].filter(Boolean).join(", "), customer_summary:r.customer_name }));
    }
    case "crm.owner.operations-summary": {
      const rows = await portableQuery<Row>(
        `SELECT status, COUNT(*) AS total FROM jobs WHERE account_id=$1 GROUP BY status`, [query.company_id]);
      const counts = Object.fromEntries(rows.map(r => [String(r.status), Number(r.total ?? 0)]));
      return [{ scheduled:counts.scheduled ?? 0, in_progress:counts.in_progress ?? 0, unassigned:counts.draft ?? 0, exceptions:(counts.blocked ?? 0)+(counts.cancelled ?? 0), revenue_preview:0 }];
    }
    case "crm.owner.schedule-capacity": {
      const rows = await portableQuery<Row>(
        `SELECT scheduled_start FROM visits WHERE account_id=$1 ORDER BY scheduled_start DESC LIMIT 6`, [query.company_id]);
      const grouped = new Map<string,number>();
      for (const row of rows) { const date=String(row.scheduled_start ?? "").slice(0,10); if(date) grouped.set(date,(grouped.get(date)??0)+1); }
      return [...grouped].map(([date,booked]) => ({ date, capacity:booked, booked, available:0 })).slice(0,6);
    }
    default: return null;
  }
}

const workcore: BuilderCapabilityProjectionExecutor = async (query, context) => {
  assertQuery(query, context);
  const records=await workCoreRows(query);
  return records ? { company_id:query.company_id, records } : null;
};

const titanMoney: BuilderCapabilityProjectionExecutor = async (query, context) => {
  assertQuery(query, context);
  if (query.contract === "crm.customer.invoices") {
    const rows=await portableQuery<Row>(`SELECT id, invoice_number, status, total_cents, due_date FROM invoices WHERE account_id=$1 ORDER BY created_at DESC LIMIT 6`,[query.company_id]);
    return {company_id:query.company_id,records:rows.map(r=>({id:r.id,number:r.invoice_number,status:r.status,amount:cents(r.total_cents),currency:"AUD",due_at:iso(r.due_date)}))};
  }
  if (query.contract === "crm.customer.quotes") {
    const rows=await portableQuery<Row>(`SELECT id, status, total_cents, expires_at, created_at FROM estimates WHERE account_id=$1 ORDER BY created_at DESC LIMIT 6`,[query.company_id]);
    return {company_id:query.company_id,records:rows.map(r=>({id:r.id,number:String(r.id??"").slice(0,8),status:r.status,amount:cents(r.total_cents),currency:"AUD",expires_at:iso(r.expires_at)}))};
  }
  if (query.contract === "crm.owner.finance-summary") {
    const invoiceRows=await portableQuery<Row>(`SELECT status, total_cents, paid_cents FROM invoices WHERE account_id=$1`,[query.company_id]);
    const estimateRows=await portableQuery<Row>(`SELECT total_cents FROM estimates WHERE account_id=$1`,[query.company_id]);
    const invoiced=invoiceRows.reduce((s,r)=>s+cents(r.total_cents),0), paid=invoiceRows.reduce((s,r)=>s+cents(r.paid_cents),0);
    const overdue=invoiceRows.filter(r=>String(r.status)==="overdue").reduce((s,r)=>s+Math.max(0,cents(r.total_cents)-cents(r.paid_cents)),0);
    return {company_id:query.company_id,records:[{period:"current",quoted:estimateRows.reduce((s,r)=>s+cents(r.total_cents),0),invoiced,paid,overdue}]};
  }
  return null;
};

/** Server-only bridge: canonical domains execute the read; Builder receives only bounded DTOs. */
export function createServerBuilderProjectionProvider() {
  return createCapabilityOwnedBuilderProjectionProvider({ workcore, titanMoney });
}
