import { buildNativeGovernance, applyNativeGovernanceHeaders, assertNativeExecutionAuthority } from "./governance";
import type { AuthSession } from "@/lib/auth/middleware";
import { buildTitanCustomerCarePlan, type TitanCustomerCarePlanInput } from "@titan-zero/titan-platform/workforce-native";

export type CustomerCareNativeRequest = Omit<TitanCustomerCarePlanInput, "companyId" | "actorId"> & { dryRun?: boolean };
const ALLOWED_ROLES = new Set(["owner", "admin"]);
function assertRole(session: AuthSession) { if (!ALLOWED_ROLES.has(session.role)) throw new Error("ROLE_NOT_AUTHORIZED"); }
function materializePath(path: string, plan: ReturnType<typeof buildTitanCustomerCarePlan>) { let out = path; if (out.includes(":id")) { if (!plan.entity_id) throw new Error("customer-care-entity-id-required"); out = out.replace(":id", encodeURIComponent(plan.entity_id)); } if (out.includes(":issueId")) { if (!plan.issue_id) throw new Error("customer-care-issue-id-required"); out = out.replace(":issueId", encodeURIComponent(plan.issue_id)); } return out; }
function buildSearch(query: Readonly<Record<string, unknown>>) { const s = new URLSearchParams(); for (const [k, v] of Object.entries(query)) if (v != null && String(v).trim()) s.set(k, String(v)); const q = s.toString(); return q ? `?${q}` : ""; }
export function buildNativeCustomerCarePlan(session: AuthSession, input: CustomerCareNativeRequest) { assertRole(session); return buildTitanCustomerCarePlan({ ...input, companyId: session.accountId, actorId: session.userId, traceId: input.traceId ?? session.traceId }); }
export async function executeNativeCustomerCareAction(request: Request, session: AuthSession, input: CustomerCareNativeRequest) {
  const plan = buildNativeCustomerCarePlan(session, input); const governance = buildNativeGovernance(session, plan, request);
  if (input.dryRun || plan.operation === null) return { dryRun: Boolean(input.dryRun), executed: false, plan, governance } as const;
  assertNativeExecutionAuthority(plan);
  const source = new URL(request.url); const target = new URL(`${materializePath(plan.operation.path, plan)}${buildSearch(plan.query)}`, source.origin);
  const headers = applyNativeGovernanceHeaders(new Headers(), governance); const cookie = request.headers.get("cookie"); if (cookie) headers.set("cookie", cookie);
  headers.set("accept", "application/json"); headers.set("x-titan-workforce-agent", "customer_care"); headers.set("x-titan-workforce-operation", plan.operation.id); headers.set("x-titan-company-id", session.accountId); headers.set("x-titan-trace-id", session.traceId); if (plan.operation.method !== "GET") headers.set("content-type", "application/json");
  const response = await fetch(target, { method: plan.operation.method, headers, body: plan.operation.method === "GET" ? undefined : JSON.stringify(plan.body ?? {}), cache: "no-store", redirect: "manual" });
  const ct = response.headers.get("content-type") ?? ""; const result = ct.includes("application/json") ? await response.json().catch(() => null) : await response.text().catch(() => "");
  return { dryRun: false, executed: true, plan, governance, upstream: { status: response.status, ok: response.ok, result } } as const;
}
