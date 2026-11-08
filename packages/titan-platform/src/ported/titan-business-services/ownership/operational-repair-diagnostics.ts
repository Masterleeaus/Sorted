import { assertTitanBusinessWorkflowBoundary, getTitanBusinessWorkflowOwner, type TitanBusinessWorkflowId } from "./workflow-ownership.js";

export const TITAN_BUSINESS_WORKFLOW_DIAGNOSTICS_SCHEMA = "titan.zero.business.workflow-operational-diagnostics/v1" as const;

export type TitanBusinessWorkflowGapKind =
  | "ORPHAN_JOB"
  | "ORPHAN_INVOICE"
  | "BROKEN_BOOKING_LINK"
  | "PAYMENT_RECONCILIATION_GAP";

export type TitanBusinessWorkflowDiagnosticEvidence = Readonly<{
  evidence_id: string;
  company_id: string;
  correlation_id: string;
  workflow_id: TitanBusinessWorkflowId;
  canonical_domain_surface: string;
  subject_ref: string;
  expected_link_ref: string | null;
  observed_link_ref: string | null;
  canonical_exists: boolean;
  counterpart_exists: boolean;
  reconciliation_state: "MATCHED" | "MISSING" | "DIVERGED" | "UNKNOWN";
}>;

export type TitanBusinessWorkflowOperationalRepairCommand = Readonly<{
  command_id: string;
  company_id: string;
  correlation_id: string;
  workflow_id: TitanBusinessWorkflowId;
  gap_kind: TitanBusinessWorkflowGapKind;
  subject_ref: string;
  action: "RELINK" | "RECONCILE" | "CREATE_MISSING_COUNTERPART" | "MANUAL_REVIEW";
  canonical_domain_surface: string;
  reason_code: string;
  requires_canonical_domain_authorization: true;
  destructive_rollback_forbidden: true;
  idempotency_required: true;
}>;

export type TitanBusinessWorkflowOperationalDiagnostic = Readonly<{
  diagnostic_id: string;
  company_id: string;
  correlation_id: string;
  workflow_id: TitanBusinessWorkflowId;
  gap_kind: TitanBusinessWorkflowGapKind;
  subject_ref: string;
  severity: "WARNING" | "ERROR";
  reason_code: string;
  repair: TitanBusinessWorkflowOperationalRepairCommand;
}>;

export type TitanBusinessWorkflowOperationalDiagnosticsReport = Readonly<{
  schema: typeof TITAN_BUSINESS_WORKFLOW_DIAGNOSTICS_SCHEMA;
  company_id: string;
  correlation_id: string;
  diagnostics: readonly TitanBusinessWorkflowOperationalDiagnostic[];
  read_only_evidence: true;
  direct_mutation_permitted: false;
  canonical_business_state_remains_source_of_truth: true;
}>;

function token(value: unknown, code: string, max = 180): string {
  const out = String(value ?? "").trim();
  if (!out || out.length > max || out.includes("/") || out.includes("\\") || out.includes("..")) throw new Error(code);
  return out;
}

function classify(e: TitanBusinessWorkflowDiagnosticEvidence): Readonly<{
  gap: TitanBusinessWorkflowGapKind;
  action: TitanBusinessWorkflowOperationalRepairCommand["action"];
  reason: string;
  severity: TitanBusinessWorkflowOperationalDiagnostic["severity"];
}> | null {
  if (e.reconciliation_state === "MATCHED") return null;

  switch (e.workflow_id) {
    case "create_job_v1":
    case "complete_job_v1":
      if (e.canonical_exists && !e.counterpart_exists) return Object.freeze({ gap: "ORPHAN_JOB", action: "RELINK", reason: "job-counterpart-link-missing", severity: "ERROR" });
      break;
    case "create_invoice_v1":
      if (e.canonical_exists && !e.counterpart_exists) return Object.freeze({ gap: "ORPHAN_INVOICE", action: "CREATE_MISSING_COUNTERPART", reason: "invoice-counterpart-missing", severity: "ERROR" });
      break;
    case "service_booking_v1":
      if (e.canonical_exists && (!e.counterpart_exists || e.reconciliation_state === "DIVERGED")) return Object.freeze({ gap: "BROKEN_BOOKING_LINK", action: "RELINK", reason: "booking-link-missing-or-diverged", severity: "WARNING" });
      break;
    case "payment-reconciliation":
      return Object.freeze({ gap: "PAYMENT_RECONCILIATION_GAP", action: "RECONCILE", reason: "payment-state-not-reconciled", severity: "ERROR" });
    default:
      break;
  }

  if (e.reconciliation_state === "UNKNOWN") return Object.freeze({ gap: "PAYMENT_RECONCILIATION_GAP", action: "MANUAL_REVIEW", reason: "canonical-state-unknown", severity: "WARNING" });
  return null;
}

function assertEvidenceBoundary(e: TitanBusinessWorkflowDiagnosticEvidence, companyId: string, correlationId: string): void {
  if (assertTitanBusinessWorkflowBoundary(e.company_id) !== companyId) throw new Error("workflow-diagnostic-company-mismatch");
  if (token(e.correlation_id, "workflow-diagnostic-correlation-required") !== correlationId) throw new Error("workflow-diagnostic-correlation-mismatch");
  token(e.evidence_id, "workflow-diagnostic-evidence-id-required");
  token(e.subject_ref, "workflow-diagnostic-subject-ref-required");
  if (e.expected_link_ref !== null) token(e.expected_link_ref, "workflow-diagnostic-expected-link-invalid");
  if (e.observed_link_ref !== null) token(e.observed_link_ref, "workflow-diagnostic-observed-link-invalid");

  const owner = getTitanBusinessWorkflowOwner(e.workflow_id);
  if (!owner) throw new Error("workflow-diagnostic-owner-unresolved");
  if (!owner.canonicalMutationSurfaces.includes(e.canonical_domain_surface)) throw new Error("workflow-diagnostic-domain-surface-mismatch");
}

export function buildTitanBusinessWorkflowOperationalDiagnostics(input: Readonly<{
  companyId: string;
  correlationId: string;
  evidence: readonly TitanBusinessWorkflowDiagnosticEvidence[];
}>): TitanBusinessWorkflowOperationalDiagnosticsReport {
  const company_id = assertTitanBusinessWorkflowBoundary(input.companyId);
  const correlation_id = token(input.correlationId, "workflow-diagnostic-correlation-required");
  if (!Array.isArray(input.evidence)) throw new Error("workflow-diagnostic-evidence-required");
  if (input.evidence.length > 128) throw new Error("workflow-diagnostic-evidence-limit");

  const seen = new Set<string>();
  const diagnostics: TitanBusinessWorkflowOperationalDiagnostic[] = [];
  for (const evidence of input.evidence) {
    assertEvidenceBoundary(evidence, company_id, correlation_id);
    if (seen.has(evidence.evidence_id)) throw new Error("workflow-diagnostic-duplicate-evidence");
    seen.add(evidence.evidence_id);
    const c = classify(evidence);
    if (!c) continue;
    const command_id = `diagnostic-repair:${evidence.workflow_id}:${evidence.subject_ref}:${c.action.toLowerCase()}`;
    diagnostics.push(Object.freeze({
      diagnostic_id: `diagnostic:${evidence.evidence_id}:${c.gap.toLowerCase()}`,
      company_id,
      correlation_id,
      workflow_id: evidence.workflow_id,
      gap_kind: c.gap,
      subject_ref: evidence.subject_ref,
      severity: c.severity,
      reason_code: c.reason,
      repair: Object.freeze({
        command_id,
        company_id,
        correlation_id,
        workflow_id: evidence.workflow_id,
        gap_kind: c.gap,
        subject_ref: evidence.subject_ref,
        action: c.action,
        canonical_domain_surface: evidence.canonical_domain_surface,
        reason_code: c.reason,
        requires_canonical_domain_authorization: true as const,
        destructive_rollback_forbidden: true as const,
        idempotency_required: true as const,
      }),
    }));
  }

  return Object.freeze({
    schema: TITAN_BUSINESS_WORKFLOW_DIAGNOSTICS_SCHEMA,
    company_id,
    correlation_id,
    diagnostics: Object.freeze(diagnostics),
    read_only_evidence: true as const,
    direct_mutation_permitted: false as const,
    canonical_business_state_remains_source_of_truth: true as const,
  });
}

export function assertTitanBusinessWorkflowDiagnosticRepairExecutable(input: Readonly<{
  report: TitanBusinessWorkflowOperationalDiagnosticsReport;
  commandId: string;
  companyId: string;
  correlationId: string;
}>): TitanBusinessWorkflowOperationalRepairCommand {
  const companyId = assertTitanBusinessWorkflowBoundary(input.companyId);
  if (companyId !== input.report.company_id) throw new Error("workflow-diagnostic-repair-company-mismatch");
  const correlationId = token(input.correlationId, "workflow-diagnostic-repair-correlation-required");
  if (correlationId !== input.report.correlation_id) throw new Error("workflow-diagnostic-repair-correlation-mismatch");
  const commandId = token(input.commandId, "workflow-diagnostic-repair-command-required", 260);
  const command = input.report.diagnostics.map((d) => d.repair).find((r) => r.command_id === commandId);
  if (!command) throw new Error("workflow-diagnostic-repair-command-unresolved");
  if (!command.requires_canonical_domain_authorization || !command.destructive_rollback_forbidden || !command.idempotency_required) {
    throw new Error("workflow-diagnostic-repair-policy-invalid");
  }
  return command;
}
