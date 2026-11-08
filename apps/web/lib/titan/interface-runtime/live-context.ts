import { getSession } from "@/lib/auth/session";
import { getPortalSession } from "@/lib/portal/session";
import { queryForSession, query, queryOne } from "@/lib/db";
import { buildBusinessRuntimeContext, type Surface } from "./business-context";
import type { AttentionEventRow } from "@/lib/attention/types";

type Row = Record<string, unknown>;


export async function loadLiveInterfaceContext(surface: Surface) {
  if (surface === "hub") return loadHubContext();
  const session = await getSession();
  if (!session) return null;
  const accountId = session.accountId;
  const jobSql = surface === "go" && session.role === "tech"
    ? `SELECT DISTINCT j.id,j.title,j.status,j.priority FROM jobs j JOIN visits v ON v.job_id=j.id AND v.account_id=j.account_id WHERE j.account_id=$1 AND v.assigned_user_id=$2 AND j.status IN ('scheduled','in_progress') ORDER BY j.priority DESC LIMIT 12`
    : `SELECT id,title,status,priority FROM jobs WHERE account_id=$1 AND status IN ('scheduled','in_progress') ORDER BY priority DESC,created_at DESC LIMIT 12`;
  const params = surface === "go" && session.role === "tech" ? [accountId,session.userId] : [accountId];
  const [activeJobs, attention] = await Promise.all([
    queryForSession<Row>(session, jobSql, params),
    surface === "zero" ? queryForSession<AttentionEventRow & Record<string, unknown>>(session, `SELECT id,account_id,type,entity_type,entity_id,title,summary,href,dedupe_key,created_at,read_at FROM attention_events WHERE account_id=$1 AND read_at IS NULL ORDER BY created_at DESC LIMIT 30`, [accountId]) : Promise.resolve([]),
  ]);
  return buildBusinessRuntimeContext({company_id:accountId,surface,activeJobs,attention,decisions:[]});
}

async function loadHubContext(){
  const portal = await getPortalSession(); if(!portal) return null;
  const client = await queryOne<{account_id:string}>(`SELECT account_id::text FROM clients WHERE id=$1`,[portal.clientId]);
  if(!client) return null;
  const services = await query<Row>(`SELECT id,title,status FROM jobs WHERE account_id=$1 AND client_id=$2 AND status NOT IN ('cancelled') ORDER BY created_at DESC LIMIT 12`,[client.account_id,portal.clientId]);
  return buildBusinessRuntimeContext({company_id:client.account_id,surface:"hub",services});
}
