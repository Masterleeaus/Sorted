import { buildNativeGovernance, applyNativeGovernanceHeaders, assertNativeExecutionAuthority } from "./governance";
import type { AuthSession } from "@/lib/auth/middleware";
import { buildTitanReceptionPlan, type TitanReceptionPlanInput } from "@titan-zero/titan-platform/workforce-native";

export type ReceptionNativeRequest = Omit<TitanReceptionPlanInput, "companyId" | "actorId"> & { dryRun?: boolean };
const ALLOWED_ROLES = new Set(["owner", "admin"]);
function assertReceptionRole(session: AuthSession): void { if (!ALLOWED_ROLES.has(session.role)) throw new Error("ROLE_NOT_AUTHORIZED"); }
function buildSearch(query: Readonly<Record<string, string>>): string { const search = new URLSearchParams(); for (const [key, value] of Object.entries(query)) search.set(key, value); const encoded = search.toString(); return encoded ? `?${encoded}` : ""; }
export function buildNativeReceptionPlan(session: AuthSession, input: ReceptionNativeRequest) { assertReceptionRole(session); return buildTitanReceptionPlan({ ...input, companyId: session.accountId, actorId: session.userId, traceId: input.traceId ?? session.traceId }); }
export async function executeNativeReceptionAction(request: Request, session: AuthSession, input: ReceptionNativeRequest) {
  const plan = buildNativeReceptionPlan(session, input); const governance = buildNativeGovernance(session, plan, request);
  if (input.dryRun || plan.operation === null) return { dryRun: Boolean(input.dryRun), executed: false, plan, governance } as const;
  assertNativeExecutionAuthority(plan);
  const source = new URL(request.url); const target = new URL(`${plan.operation.path}${buildSearch(plan.query)}`, source.origin);
  const headers = applyNativeGovernanceHeaders(new Headers(), governance); const cookie = request.headers.get("cookie"); if (cookie) headers.set("cookie", cookie);
  headers.set("accept", "application/json"); headers.set("x-titan-workforce-agent", "reception"); headers.set("x-titan-workforce-operation", plan.operation.id); headers.set("x-titan-company-id", session.accountId); headers.set("x-titan-trace-id", session.traceId); if (plan.operation.method !== "GET") headers.set("content-type", "application/json");
  const response = await fetch(target, { method: plan.operation.method, headers, body: plan.operation.method === "GET" ? undefined : JSON.stringify(plan.body ?? {}), cache: "no-store", redirect: "manual" });
  const contentType = response.headers.get("content-type") ?? ""; const result = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text().catch(() => "");
  return { dryRun: false, executed: true, plan, governance, upstream: { status: response.status, ok: response.ok, result } } as const;
}
