import {
  assertTitanBusinessWorkflowBoundary,
  getTitanBusinessWorkflowOwner,
  type TitanBusinessWorkflowId,
  type TitanBusinessWorkflowOwnership,
} from "./workflow-ownership.js";

export const TITAN_BUSINESS_WORKFLOW_RUNNER_SCHEMA = "titan.zero.business.workflow-runner/v1" as const;

export type TitanBusinessWorkflowHttpMethod = "POST" | "PATCH";

export type TitanBusinessWorkflowRunPlan = Readonly<{
  schema: typeof TITAN_BUSINESS_WORKFLOW_RUNNER_SCHEMA;
  workflow_id: TitanBusinessWorkflowId;
  company_id: string;
  actor_id: string | null;
  correlation_id: string;
  idempotency_key: string;
  capability: string;
  canonical_owner: string;
  canonical_domain_surface: string;
  method: TitanBusinessWorkflowHttpMethod;
  input: Readonly<Record<string, unknown>>;
  authority: Readonly<{
    identity_grants_authority: false;
    execution_permitted: false;
    canonical_domain_authorization_required: true;
  }>;
}>;

export type TitanBusinessWorkflowDomainAdapter = Readonly<{
  authorize(plan: TitanBusinessWorkflowRunPlan): Promise<boolean> | boolean;
  invoke(plan: TitanBusinessWorkflowRunPlan): Promise<unknown> | unknown;
}>;

const PRIMARY_SURFACE: Readonly<Record<TitanBusinessWorkflowId, Readonly<{ surface: string; method: TitanBusinessWorkflowHttpMethod }>>> = Object.freeze({
  new_customer_v1: Object.freeze({ surface: "/api/v1/clients", method: "POST" }),
  create_quote_v1: Object.freeze({ surface: "/api/v1/estimates", method: "POST" }),
  service_booking_v1: Object.freeze({ surface: "/api/v1/booking-requests", method: "POST" }),
  create_job_v1: Object.freeze({ surface: "/api/v1/work-orders", method: "POST" }),
  complete_job_v1: Object.freeze({ surface: "/api/v1/work-orders/[id]/complete", method: "POST" }),
  job_variation_approval_v1: Object.freeze({ surface: "/api/v1/work-orders/[id]", method: "PATCH" }),
  create_invoice_v1: Object.freeze({ surface: "/api/v1/invoices", method: "POST" }),
  "payment-reconciliation": Object.freeze({ surface: "/api/v1/invoices/[id]/payments", method: "POST" }),
});

function boundedToken(value: unknown, code: string, max = 180): string {
  const token = String(value ?? "").trim();
  if (!token || token.length > max || token.includes("/") || token.includes("\\") || token.includes("..")) {
    throw new Error(code);
  }
  return token;
}

function freezeInput(input: unknown): Readonly<Record<string, unknown>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return Object.freeze({});
  const copy = { ...(input as Record<string, unknown>) };
  for (const key of ["company_id", "companyId", "tenant_id", "tenantId", "tenant_company_id", "account_id"]) {
    if (key in copy) throw new Error(`workflow-runner-company-boundary-owned:${key}`);
  }
  return Object.freeze(copy);
}

function routeFor(owner: TitanBusinessWorkflowOwnership): Readonly<{ surface: string; method: TitanBusinessWorkflowHttpMethod }> {
  const route = PRIMARY_SURFACE[owner.workflowId];
  if (!route || !owner.canonicalMutationSurfaces.includes(route.surface)) {
    throw new Error(`workflow-runner-domain-surface-unresolved:${owner.workflowId}`);
  }
  return route;
}

export function buildTitanBusinessWorkflowRunPlan(input: Readonly<{
  workflowId: string;
  companyId: string;
  actorId?: string | null;
  correlationId: string;
  idempotencyKey: string;
  input?: Readonly<Record<string, unknown>> | null;
}>): TitanBusinessWorkflowRunPlan {
  const company_id = assertTitanBusinessWorkflowBoundary(input.companyId);
  const owner = getTitanBusinessWorkflowOwner(input.workflowId);
  if (!owner) throw new Error(`workflow-owner-unresolved:${String(input.workflowId ?? "")}`);
  const route = routeFor(owner);
  return Object.freeze({
    schema: TITAN_BUSINESS_WORKFLOW_RUNNER_SCHEMA,
    workflow_id: owner.workflowId,
    company_id,
    actor_id: input.actorId ? boundedToken(input.actorId, "workflow-runner-actor-id-invalid", 128) : null,
    correlation_id: boundedToken(input.correlationId, "workflow-runner-correlation-id-required"),
    idempotency_key: boundedToken(input.idempotencyKey, "workflow-runner-idempotency-key-required"),
    capability: owner.capability,
    canonical_owner: owner.canonicalOwner,
    canonical_domain_surface: route.surface,
    method: route.method,
    input: freezeInput(input.input),
    authority: Object.freeze({
      identity_grants_authority: false,
      execution_permitted: false,
      canonical_domain_authorization_required: true,
    }),
  });
}

export async function executeTitanBusinessWorkflowRunPlan(input: Readonly<{
  plan: TitanBusinessWorkflowRunPlan;
  adapter: TitanBusinessWorkflowDomainAdapter;
}>): Promise<Readonly<{ status: "SUCCEEDED" | "DENIED"; plan: TitanBusinessWorkflowRunPlan; result?: unknown }>> {
  const plan = input.plan;
  assertTitanBusinessWorkflowBoundary(plan.company_id);
  const owner = getTitanBusinessWorkflowOwner(plan.workflow_id);
  if (!owner || owner.canonicalOwner !== plan.canonical_owner) throw new Error("workflow-runner-owner-drift");
  const route = routeFor(owner);
  if (route.surface !== plan.canonical_domain_surface || route.method !== plan.method) throw new Error("workflow-runner-domain-surface-drift");
  if (!(await input.adapter.authorize(plan))) {
    return Object.freeze({ status: "DENIED", plan });
  }
  const result = await input.adapter.invoke(plan);
  return Object.freeze({ status: "SUCCEEDED", plan, result });
}
