/**
 * Canonical ownership map for Titan business-service workflows.
 *
 * The Interaction Engine workflow definitions and native workforce workflow
 * runtime are orchestration/routing layers only. They never become the source
 * of truth for CRM, bookings, jobs/work orders, invoices, or payments.
 */
export const TITAN_BUSINESS_WORKFLOW_OWNERSHIP_SCHEMA = "titan.zero.business.workflow-ownership/v1" as const;
export const TITAN_BUSINESS_WORKFLOW_COMPANY_BOUNDARY = "company_id" as const;

export type TitanBusinessWorkflowService =
  | "crm"
  | "quotes"
  | "bookings"
  | "jobs_work_orders"
  | "invoicing"
  | "payments";

export type TitanBusinessWorkflowId =
  | "new_customer_v1"
  | "create_quote_v1"
  | "service_booking_v1"
  | "create_job_v1"
  | "complete_job_v1"
  | "job_variation_approval_v1"
  | "create_invoice_v1"
  | "payment-reconciliation";

export type TitanBusinessWorkflowOwner = Readonly<{
  workflowId: TitanBusinessWorkflowId;
  service: TitanBusinessWorkflowService;
  capability: string;
  definition: string;
  canonicalOwner: string;
  canonicalMutationSurfaces: readonly string[];
  orchestrationOnly: true;
  executionMustUseCanonicalDomainSurface: true;
}>;

export const TITAN_BUSINESS_WORKFLOW_OWNERS = Object.freeze([
  Object.freeze({
    workflowId: "new_customer_v1",
    service: "crm",
    capability: "crm.customer.create",
    definition: "titan-business-services/workflows/new_customer.json",
    canonicalOwner: "Titan CRM",
    canonicalMutationSurfaces: Object.freeze(["/api/v1/clients"]),
    orchestrationOnly: true,
    executionMustUseCanonicalDomainSurface: true,
  }),
  Object.freeze({
    workflowId: "create_quote_v1",
    service: "quotes",
    capability: "crm.quote.create",
    definition: "titan-business-services/workflows/create_quote.json",
    canonicalOwner: "Titan CRM",
    canonicalMutationSurfaces: Object.freeze(["/api/v1/estimates"]),
    orchestrationOnly: true,
    executionMustUseCanonicalDomainSurface: true,
  }),
  Object.freeze({
    workflowId: "service_booking_v1",
    service: "bookings",
    capability: "crm.appointment.create",
    definition: "titan-business-services/workflows/service_booking.json",
    canonicalOwner: "CRM revenue journey + Titan Bookings/Quotes lifecycle engine",
    canonicalMutationSurfaces: Object.freeze(["/api/v1/booking-requests", "/api/v1/booking-requests/[id]/convert"]),
    orchestrationOnly: true,
    executionMustUseCanonicalDomainSurface: true,
  }),
  Object.freeze({
    workflowId: "create_job_v1",
    service: "jobs_work_orders",
    capability: "crm.work_order.create",
    definition: "titan-business-services/workflows/create_job.json",
    canonicalOwner: "Titan Field",
    canonicalMutationSurfaces: Object.freeze(["/api/v1/work-orders", "/api/v1/estimates/[id]/create-job"]),
    orchestrationOnly: true,
    executionMustUseCanonicalDomainSurface: true,
  }),
  Object.freeze({
    workflowId: "complete_job_v1",
    service: "jobs_work_orders",
    capability: "crm.work_order.complete",
    definition: "titan-business-services/workflows/complete_job.json",
    canonicalOwner: "Titan Field",
    canonicalMutationSurfaces: Object.freeze(["/api/v1/work-orders/[id]/complete"]),
    orchestrationOnly: true,
    executionMustUseCanonicalDomainSurface: true,
  }),
  Object.freeze({
    workflowId: "job_variation_approval_v1",
    service: "jobs_work_orders",
    capability: "crm.work_order.update",
    definition: "titan-business-services/workflows/job_variation_approval.json",
    canonicalOwner: "Titan Field",
    canonicalMutationSurfaces: Object.freeze(["/api/v1/work-orders/[id]"]),
    orchestrationOnly: true,
    executionMustUseCanonicalDomainSurface: true,
  }),
  Object.freeze({
    workflowId: "create_invoice_v1",
    service: "invoicing",
    capability: "crm.invoice.create",
    definition: "titan-business-services/workflows/create_invoice.json",
    canonicalOwner: "Titan CRM revenue document authority",
    canonicalMutationSurfaces: Object.freeze(["/api/v1/invoices"]),
    orchestrationOnly: true,
    executionMustUseCanonicalDomainSurface: true,
  }),
  Object.freeze({
    workflowId: "payment-reconciliation",
    service: "payments",
    capability: "finance.payment.reconcile",
    definition: "titan-business-services/workflows/payment_reconciliation.json",
    canonicalOwner: "Titan CRM receivable/payment lifecycle pending dedicated Titan Pay master",
    canonicalMutationSurfaces: Object.freeze(["/api/v1/invoices/[id]/payments", "/api/v1/payments/[id]"]),
    orchestrationOnly: true,
    executionMustUseCanonicalDomainSurface: true,
  }),
] as const satisfies readonly TitanBusinessWorkflowOwner[]);

export type TitanBusinessWorkflowOwnership = (typeof TITAN_BUSINESS_WORKFLOW_OWNERS)[number];

const BY_ID = new Map<TitanBusinessWorkflowId, TitanBusinessWorkflowOwnership>(
  TITAN_BUSINESS_WORKFLOW_OWNERS.map((entry) => [entry.workflowId, entry])
);

export function getTitanBusinessWorkflowOwner(workflowId: string): TitanBusinessWorkflowOwnership | null {
  return BY_ID.get(workflowId as TitanBusinessWorkflowId) ?? null;
}

export function assertTitanBusinessWorkflowBoundary(companyId: unknown): string {
  const value = String(companyId ?? "").trim();
  if (!value) throw new Error("workflow-company-id-required");
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new Error("workflow-company-id-invalid");
  }
  return value;
}

export type TitanBusinessWorkflowOwnershipSnapshot = Readonly<{
  schema: typeof TITAN_BUSINESS_WORKFLOW_OWNERSHIP_SCHEMA;
  company_id: string;
  workflow: TitanBusinessWorkflowOwnership;
  authority: Readonly<{
    workflow_identity_grants_authority: false;
    orchestrator_owns_domain_truth: false;
    canonical_domain_authorization_required: true;
  }>;
}>;

export function buildTitanBusinessWorkflowOwnershipSnapshot(input: Readonly<{
  companyId: string;
  workflowId: string;
}>): TitanBusinessWorkflowOwnershipSnapshot {
  const company_id = assertTitanBusinessWorkflowBoundary(input.companyId);
  const workflow = getTitanBusinessWorkflowOwner(input.workflowId);
  if (!workflow) throw new Error(`workflow-owner-unresolved:${String(input.workflowId ?? "")}`);
  return Object.freeze({
    schema: TITAN_BUSINESS_WORKFLOW_OWNERSHIP_SCHEMA,
    company_id,
    workflow,
    authority: Object.freeze({
      workflow_identity_grants_authority: false,
      orchestrator_owns_domain_truth: false,
      canonical_domain_authorization_required: true,
    }),
  });
}
