// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-workforce/starter-agents/jobs/jobs-domain-audit.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
const freeze = (value) => Object.freeze(value);

export const JOBS_CANONICAL_DOMAIN_AUDIT = freeze({
  schema: "titan-zero-jobs-domain-audit/v1",
  company_boundary: "company_id",
  worker: "Jobs Agent",
  authority: freeze({
    service_requests: "Titan Field",
    work_orders: "Titan Field",
    job_execution: "Titan Field",
    dispatch_operational_state: "Titan Field",
    forms_evidence: "Titan Field",
    appointments: "Titan CRM booking/appointment capability projected into Titan Field execution context",
    human_time_attendance: "Titan People + Payroll + Time Attendance",
    invoices: "Titan CRM revenue document authority"
  }),
  authoritative_workflows: freeze([
    freeze({ id: "create_job_v1", capability: "crm.work_order.create", file: "titan-business-services/workflows/create_job.json", surfaces: freeze(["command"]), offline: true }),
    freeze({ id: "complete_job_v1", capability: "crm.work_order.complete", file: "titan-business-services/workflows/complete_job.json", surfaces: freeze(["go", "command"]), offline: true }),
    freeze({ id: "job_variation_approval_v1", capability: "crm.work_order.update", file: "titan-business-services/workflows/job_variation_approval.json", surfaces: freeze(["go", "command"]), offline: true })
  ]),
  canonical_lifecycle: freeze([
    "planned",
    "assigned",
    "en_route",
    "started",
    "blocked",
    "completed",
    "qa_ready",
    "closed"
  ]),
  lifecycle_policy: freeze({
    pass1_status: "CANONICAL_SEQUENCE_ESTABLISHED_NOT_YET_ENFORCED",
    enforcement_owner: "Pass 2 lifecycle contract",
    terminal_business_close_requires_authority: true,
    ai_identity_grants_execution_authority: false
  }),
  context_links: freeze({
    upstream: freeze(["service_request", "booking", "appointment", "schedule", "dispatch_assignment"]),
    execution: freeze(["work_order", "job_task", "field_update", "evidence_ref", "material_ref", "time_ref"]),
    downstream: freeze(["invoice_readiness", "customer_care_handoff"])
  }),
  titan_go: freeze({
    canonical_surface: "go",
    completion_workflow_reachable: true,
    variation_workflow_reachable: true,
    offline_conflict_mode: "prompt_user",
    mutation_rule: "all execution mutations must retain company_id, operation identity/idempotency and authority checks"
  }),
  anti_duplication: freeze({
    create_parallel_job_database: false,
    create_parallel_workforce_manager: false,
    overwrite_workforce_ui_lane: false
  })
});

export function auditJobsContext(context = {}) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new TypeError("Jobs Agent context must be an object");
  }
  if ("tenant_company_id" in context || "tenant_id" in context || "tenantId" in context) {
    throw new Error("Jobs Agent authority boundary accepts company_id only");
  }
  if (typeof context.company_id !== "string" || !context.company_id.trim()) {
    throw new Error("Jobs Agent requires non-empty company_id");
  }
  return freeze({
    ok: true,
    company_id: context.company_id.trim(),
    worker: JOBS_CANONICAL_DOMAIN_AUDIT.worker,
    authority: JOBS_CANONICAL_DOMAIN_AUDIT.authority,
    lifecycle: JOBS_CANONICAL_DOMAIN_AUDIT.canonical_lifecycle,
    titan_go_surface: JOBS_CANONICAL_DOMAIN_AUDIT.titan_go.canonical_surface
  });
}

export function getJobsCanonicalLifecycle() {
  return [...JOBS_CANONICAL_DOMAIN_AUDIT.canonical_lifecycle];
}
