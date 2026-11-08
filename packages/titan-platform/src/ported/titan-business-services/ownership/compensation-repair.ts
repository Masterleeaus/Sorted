import { assertTitanBusinessWorkflowBoundary, getTitanBusinessWorkflowOwner, type TitanBusinessWorkflowId } from "./workflow-ownership.js";

export const TITAN_BUSINESS_WORKFLOW_REPAIR_SCHEMA = "titan.zero.business.workflow-repair/v1" as const;

export type TitanBusinessWorkflowEffectState = "NOT_STARTED" | "IN_FLIGHT" | "COMPLETED" | "FAILED" | "UNKNOWN";
export type TitanBusinessWorkflowRepairAction = "PRESERVE" | "RETRY_FORWARD" | "RECONCILE" | "MANUAL_REVIEW";

export type TitanBusinessWorkflowObservedEffect = Readonly<{
  effect_id: string;
  workflow_id: TitanBusinessWorkflowId;
  company_id: string;
  correlation_id: string;
  canonical_domain_surface: string;
  idempotency_key: string;
  state: TitanBusinessWorkflowEffectState;
  externally_completed: boolean;
  result_ref: string | null;
  error_code: string | null;
}>;

export type TitanBusinessWorkflowRepairCommand = Readonly<{
  command_id: string;
  company_id: string;
  correlation_id: string;
  workflow_id: TitanBusinessWorkflowId;
  effect_id: string;
  action: TitanBusinessWorkflowRepairAction;
  reason_code: string;
  canonical_domain_surface: string;
  idempotency_key: string;
  destructive_rollback_forbidden: true;
  requires_canonical_domain_authorization: true;
}>;

export type TitanBusinessWorkflowRepairPlan = Readonly<{
  schema: typeof TITAN_BUSINESS_WORKFLOW_REPAIR_SCHEMA;
  company_id: string;
  correlation_id: string;
  plan_id: string;
  revision: number;
  commands: readonly TitanBusinessWorkflowRepairCommand[];
  destructive_rollback_allowed: false;
  canonical_business_state_remains_source_of_truth: true;
}>;

function token(value: unknown, code: string, max = 180): string {
  const out = String(value ?? "").trim();
  if (!out || out.length > max || out.includes("/") || out.includes("\\") || out.includes("..")) throw new Error(code);
  return out;
}

function classify(effect: TitanBusinessWorkflowObservedEffect): Readonly<{ action: TitanBusinessWorkflowRepairAction; reason: string }> {
  if (effect.externally_completed || effect.state === "COMPLETED") {
    return Object.freeze({ action: "PRESERVE" as const, reason: "external-effect-already-complete" });
  }
  if (effect.state === "FAILED") {
    return Object.freeze({ action: "RETRY_FORWARD" as const, reason: "forward-retry-required" });
  }
  if (effect.state === "UNKNOWN" || effect.state === "IN_FLIGHT") {
    return Object.freeze({ action: "RECONCILE" as const, reason: "canonical-state-reconciliation-required" });
  }
  return Object.freeze({ action: "MANUAL_REVIEW" as const, reason: "effect-not-started-review-required" });
}

function stableCommandId(effect: TitanBusinessWorkflowObservedEffect, action: TitanBusinessWorkflowRepairAction): string {
  return `repair:${effect.workflow_id}:${effect.effect_id}:${action.toLowerCase()}`;
}

function assertEffectBoundary(effect: TitanBusinessWorkflowObservedEffect, companyId: string, correlationId: string): void {
  if (assertTitanBusinessWorkflowBoundary(effect.company_id) !== companyId) throw new Error("workflow-repair-effect-company-mismatch");
  if (token(effect.correlation_id, "workflow-repair-effect-correlation-required") !== correlationId) throw new Error("workflow-repair-effect-correlation-mismatch");
  token(effect.effect_id, "workflow-repair-effect-id-required");
  token(effect.idempotency_key, "workflow-repair-effect-idempotency-required");
  if (effect.result_ref !== null) token(effect.result_ref, "workflow-repair-result-ref-invalid");
  if (effect.error_code !== null) token(effect.error_code, "workflow-repair-error-code-invalid", 120);

  const owner = getTitanBusinessWorkflowOwner(effect.workflow_id);
  if (!owner) throw new Error("workflow-repair-owner-unresolved");
  if (!owner.canonicalMutationSurfaces.includes(effect.canonical_domain_surface)) {
    throw new Error("workflow-repair-domain-surface-mismatch");
  }
}

export function buildTitanBusinessWorkflowRepairPlan(input: Readonly<{
  companyId: string;
  correlationId: string;
  planId: string;
  effects: readonly TitanBusinessWorkflowObservedEffect[];
}>): TitanBusinessWorkflowRepairPlan {
  const company_id = assertTitanBusinessWorkflowBoundary(input.companyId);
  const correlation_id = token(input.correlationId, "workflow-repair-correlation-required");
  const plan_id = token(input.planId, "workflow-repair-plan-id-required");
  if (!Array.isArray(input.effects) || input.effects.length === 0) throw new Error("workflow-repair-effects-required");
  if (input.effects.length > 64) throw new Error("workflow-repair-effects-limit");

  const seen = new Set<string>();
  const commands = input.effects.map((effect) => {
    assertEffectBoundary(effect, company_id, correlation_id);
    if (seen.has(effect.effect_id)) throw new Error("workflow-repair-duplicate-effect");
    seen.add(effect.effect_id);
    const classification = classify(effect);
    return Object.freeze({
      command_id: stableCommandId(effect, classification.action),
      company_id,
      correlation_id,
      workflow_id: effect.workflow_id,
      effect_id: effect.effect_id,
      action: classification.action,
      reason_code: classification.reason,
      canonical_domain_surface: effect.canonical_domain_surface,
      idempotency_key: effect.idempotency_key,
      destructive_rollback_forbidden: true as const,
      requires_canonical_domain_authorization: true as const,
    });
  });

  return Object.freeze({
    schema: TITAN_BUSINESS_WORKFLOW_REPAIR_SCHEMA,
    company_id,
    correlation_id,
    plan_id,
    revision: 0,
    commands: Object.freeze(commands),
    destructive_rollback_allowed: false as const,
    canonical_business_state_remains_source_of_truth: true as const,
  });
}

export function assertTitanBusinessWorkflowRepairCommandExecutable(input: Readonly<{
  plan: TitanBusinessWorkflowRepairPlan;
  commandId: string;
  companyId: string;
  correlationId: string;
}>): TitanBusinessWorkflowRepairCommand {
  const companyId = assertTitanBusinessWorkflowBoundary(input.companyId);
  if (companyId !== input.plan.company_id) throw new Error("workflow-repair-company-mismatch");
  const correlationId = token(input.correlationId, "workflow-repair-correlation-required");
  if (correlationId !== input.plan.correlation_id) throw new Error("workflow-repair-correlation-mismatch");
  const commandId = token(input.commandId, "workflow-repair-command-id-required");
  const command = input.plan.commands.find((entry) => entry.command_id === commandId);
  if (!command) throw new Error("workflow-repair-command-unresolved");
  if (command.destructive_rollback_forbidden !== true || command.requires_canonical_domain_authorization !== true) {
    throw new Error("workflow-repair-command-policy-invalid");
  }
  return command;
}
