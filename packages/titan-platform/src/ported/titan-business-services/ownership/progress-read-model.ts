import type { TitanBusinessWorkflowExecutionState, TitanBusinessWorkflowStateStatus } from "./execution-state.js";
import type { TitanBusinessWorkflowRepairPlan, TitanBusinessWorkflowRepairAction } from "./compensation-repair.js";

export const TITAN_BUSINESS_WORKFLOW_PROGRESS_SCHEMA = "titan.zero.business.workflow-progress/v1" as const;

export type TitanBusinessWorkflowProgressPhase = "PENDING" | "ACTIVE" | "BLOCKED" | "COMPLETE" | "FAILED";
export type TitanBusinessWorkflowBlockerKind = "RETRY_REQUIRED" | "RECONCILIATION_REQUIRED" | "MANUAL_REVIEW_REQUIRED" | "FINAL_FAILURE";

export type TitanBusinessWorkflowProgressBlocker = Readonly<{
  blocker_id: string;
  kind: TitanBusinessWorkflowBlockerKind;
  action_required: "RETRY" | "RECONCILE" | "REVIEW" | "ESCALATE";
  workflow_id: string;
  effect_id: string | null;
  reason_code: string;
  canonical_domain_surface: string;
  destructive_rollback_forbidden: true;
}>;

export type TitanBusinessWorkflowProgressReadModel = Readonly<{
  schema: typeof TITAN_BUSINESS_WORKFLOW_PROGRESS_SCHEMA;
  company_id: string;
  correlation_id: string;
  workflow_id: string;
  revision: number;
  phase: TitanBusinessWorkflowProgressPhase;
  progress_percent: number;
  current_attempt: number;
  max_attempts: number;
  blockers: readonly TitanBusinessWorkflowProgressBlocker[];
  terminal: boolean;
  result_ref: string | null;
  read_only: true;
  mutable_internal_state_exposed: false;
  mutation_permitted: false;
}>;

function token(value: unknown, code: string, max = 180): string {
  const out = String(value ?? "").trim();
  if (!out || out.length > max || out.includes("/") || out.includes("\\") || out.includes("..")) throw new Error(code);
  return out;
}

function phaseFor(status: TitanBusinessWorkflowStateStatus, blockers: readonly TitanBusinessWorkflowProgressBlocker[]): TitanBusinessWorkflowProgressPhase {
  if (status === "SUCCEEDED") return "COMPLETE";
  if (status === "FAILED_FINAL") return "FAILED";
  if (blockers.length > 0 || status === "RETRY_WAIT") return "BLOCKED";
  if (status === "RUNNING") return "ACTIVE";
  return "PENDING";
}

function progressFor(status: TitanBusinessWorkflowStateStatus): number {
  switch (status) {
    case "PENDING": return 0;
    case "RUNNING": return 50;
    case "RETRY_WAIT": return 50;
    case "SUCCEEDED": return 100;
    case "FAILED_FINAL": return 100;
  }
}

function blockerFromRepair(action: TitanBusinessWorkflowRepairAction): Readonly<{ kind: TitanBusinessWorkflowBlockerKind; actionRequired: TitanBusinessWorkflowProgressBlocker["action_required"] }> | null {
  switch (action) {
    case "PRESERVE": return null;
    case "RETRY_FORWARD": return Object.freeze({ kind: "RETRY_REQUIRED", actionRequired: "RETRY" });
    case "RECONCILE": return Object.freeze({ kind: "RECONCILIATION_REQUIRED", actionRequired: "RECONCILE" });
    case "MANUAL_REVIEW": return Object.freeze({ kind: "MANUAL_REVIEW_REQUIRED", actionRequired: "REVIEW" });
  }
}

export function buildTitanBusinessWorkflowProgressReadModel(input: Readonly<{
  state: TitanBusinessWorkflowExecutionState;
  repairPlan?: TitanBusinessWorkflowRepairPlan | null;
}>): TitanBusinessWorkflowProgressReadModel {
  const state = input.state;
  const company_id = token(state.company_id, "workflow-progress-company-required");
  const correlation_id = token(state.correlation_id, "workflow-progress-correlation-required");
  const workflow_id = token(state.workflow_id, "workflow-progress-workflow-required");

  if (input.repairPlan) {
    if (token(input.repairPlan.company_id, "workflow-progress-repair-company-required") !== company_id) throw new Error("workflow-progress-repair-company-mismatch");
    if (token(input.repairPlan.correlation_id, "workflow-progress-repair-correlation-required") !== correlation_id) throw new Error("workflow-progress-repair-correlation-mismatch");
  }

  const blockers: TitanBusinessWorkflowProgressBlocker[] = [];
  if (state.status === "FAILED_FINAL") {
    blockers.push(Object.freeze({
      blocker_id: `workflow:${workflow_id}:final-failure`,
      kind: "FINAL_FAILURE" as const,
      action_required: "ESCALATE" as const,
      workflow_id,
      effect_id: null,
      reason_code: state.error_code ? token(state.error_code, "workflow-progress-error-code-invalid", 120) : "final-failure",
      canonical_domain_surface: state.canonical_domain_surface,
      destructive_rollback_forbidden: true as const,
    }));
  }

  for (const command of input.repairPlan?.commands ?? []) {
    if (command.workflow_id !== state.workflow_id) continue;
    const mapped = blockerFromRepair(command.action);
    if (!mapped) continue;
    blockers.push(Object.freeze({
      blocker_id: command.command_id,
      kind: mapped.kind,
      action_required: mapped.actionRequired,
      workflow_id,
      effect_id: command.effect_id,
      reason_code: command.reason_code,
      canonical_domain_surface: command.canonical_domain_surface,
      destructive_rollback_forbidden: true as const,
    }));
  }

  const frozenBlockers = Object.freeze(blockers);
  return Object.freeze({
    schema: TITAN_BUSINESS_WORKFLOW_PROGRESS_SCHEMA,
    company_id,
    correlation_id,
    workflow_id,
    revision: state.revision,
    phase: phaseFor(state.status, frozenBlockers),
    progress_percent: progressFor(state.status),
    current_attempt: state.attempt,
    max_attempts: state.max_attempts,
    blockers: frozenBlockers,
    terminal: state.status === "SUCCEEDED" || state.status === "FAILED_FINAL",
    result_ref: state.status === "SUCCEEDED" ? state.result_ref : null,
    read_only: true as const,
    mutable_internal_state_exposed: false as const,
    mutation_permitted: false as const,
  });
}

export function assertTitanBusinessWorkflowProgressReadable(input: Readonly<{
  model: TitanBusinessWorkflowProgressReadModel;
  companyId: string;
  correlationId: string;
}>): TitanBusinessWorkflowProgressReadModel {
  if (token(input.companyId, "workflow-progress-company-required") !== input.model.company_id) throw new Error("workflow-progress-company-mismatch");
  if (token(input.correlationId, "workflow-progress-correlation-required") !== input.model.correlation_id) throw new Error("workflow-progress-correlation-mismatch");
  if (input.model.read_only !== true || input.model.mutation_permitted !== false || input.model.mutable_internal_state_exposed !== false) {
    throw new Error("workflow-progress-read-model-policy-invalid");
  }
  return input.model;
}
