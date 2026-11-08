import { buildTitanBookingPlan, type TitanBookingPlanInput } from "./booking.js";
import { buildTitanCustomerCarePlan, type TitanCustomerCarePlanInput } from "./customer-care.js";
import { buildTitanJobsPlan, type TitanJobsPlanInput } from "./jobs.js";
import { buildTitanReceptionPlan, type TitanReceptionPlanInput } from "./reception.js";
import { buildTitanSalesPlan, type TitanSalesPlanInput } from "./sales.js";
import { buildTitanSchedulingPlan, type TitanSchedulingPlanInput } from "./scheduling.js";
import {
  assertTitanNativeWorkforceBoundary,
  getTitanNativeWorkforceAgentMap,
  type TitanNativeWorkforceAgentKey,
} from "./contracts.js";

type NativePlanInput =
  | TitanReceptionPlanInput
  | TitanSalesPlanInput
  | TitanBookingPlanInput
  | TitanSchedulingPlanInput
  | TitanJobsPlanInput
  | TitanCustomerCarePlanInput;

type JsonRecord = Readonly<Record<string, unknown>>;

export type TitanNativeWorkflowStep = Readonly<{
  id: string;
  agentKey: TitanNativeWorkforceAgentKey;
  input: Omit<NativePlanInput, "companyId"> & Readonly<Record<string, unknown>>;
  compensation?: Readonly<{
    agentKey: TitanNativeWorkforceAgentKey;
    input: Omit<NativePlanInput, "companyId"> & Readonly<Record<string, unknown>>;
  }> | null;
}>;

export type TitanNativeWorkflowDefinition = Readonly<{
  workflowId: string;
  companyId: string;
  actorId?: string | null;
  traceId?: string | null;
  idempotencyKey: string;
  steps: readonly TitanNativeWorkflowStep[];
}>;

export type TitanNativeWorkflowPlannedStep = Readonly<{
  index: number;
  id: string;
  agentKey: TitanNativeWorkforceAgentKey;
  idempotencyKey: string;
  plan: Readonly<Record<string, unknown>>;
  mutating: boolean;
  compensation: Readonly<{
    agentKey: TitanNativeWorkforceAgentKey;
    idempotencyKey: string;
    plan: Readonly<Record<string, unknown>>;
    mutating: boolean;
  }> | null;
}>;

export type TitanNativeWorkflowPlan = Readonly<{
  schema: "titan.zero.workforce-native.workflow-plan/v1";
  workflow_id: string;
  company_id: string;
  actor_id: string | null;
  trace_id: string | null;
  idempotency_key: string;
  steps: readonly TitanNativeWorkflowPlannedStep[];
  authority: Readonly<{
    identity_grants_authority: false;
    execution_permitted: false;
    per_step_authorization_required: true;
    compensation_requires_authorization: true;
  }>;
  execution_model: Readonly<{
    sequential: true;
    stop_on_failure: true;
    retries_require_same_idempotency_key: true;
    automatic_compensation: false;
    explicit_compensation_only: true;
    delegation_runtime_owned_elsewhere: true;
  }>;
}>;

export type TitanNativeWorkflowReceipt = Readonly<{
  idempotencyKey: string;
  status: "SUCCEEDED" | "FAILED" | "COMPENSATED" | "COMPENSATION_FAILED" | "SKIPPED_DUPLICATE";
  result?: unknown;
  error?: string | null;
}>;

export type TitanNativeWorkflowLedger = Readonly<{
  get(idempotencyKey: string): Promise<TitanNativeWorkflowReceipt | null> | TitanNativeWorkflowReceipt | null;
  put(receipt: TitanNativeWorkflowReceipt): Promise<void> | void;
}>;

export type TitanNativeWorkflowExecutor = Readonly<{
  authorize(input: Readonly<{
    company_id: string;
    actor_id: string | null;
    workflow_id: string;
    step_id: string;
    agent_key: TitanNativeWorkforceAgentKey;
    plan: Readonly<Record<string, unknown>>;
    compensation: boolean;
  }>): Promise<boolean> | boolean;
  execute(input: Readonly<{
    company_id: string;
    actor_id: string | null;
    workflow_id: string;
    step_id: string;
    agent_key: TitanNativeWorkforceAgentKey;
    idempotency_key: string;
    plan: Readonly<Record<string, unknown>>;
    compensation: boolean;
  }>): Promise<unknown> | unknown;
}>;

export type TitanNativeWorkflowExecutionResult = Readonly<{
  schema: "titan.zero.workforce-native.workflow-result/v1";
  workflow_id: string;
  company_id: string;
  status: "SUCCEEDED" | "PARTIAL_FAILURE" | "FAILED_AUTHORIZATION" | "COMPENSATED" | "COMPENSATION_FAILED";
  receipts: readonly TitanNativeWorkflowReceipt[];
  failed_step_id: string | null;
  compensation_attempted: boolean;
  compensation_complete: boolean;
}>;

function clean(value: unknown, max = 180): string {
  return String(value ?? "").trim().slice(0, max);
}

function safeId(value: unknown, code: string): string {
  const id = clean(value, 180);
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) throw new Error(code);
  return id;
}

function freezeRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
  return Object.freeze({ ...(value as Record<string, unknown>) });
}

function buildAgentPlan(agentKey: TitanNativeWorkforceAgentKey, companyId: string, actorId: string | null, rawInput: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const input = Object.freeze({ ...rawInput, companyId, ...(actorId ? { actorId } : {}) }) as never;
  if (agentKey === "reception") return buildTitanReceptionPlan(input) as unknown as Readonly<Record<string, unknown>>;
  if (agentKey === "sales") return buildTitanSalesPlan(input) as unknown as Readonly<Record<string, unknown>>;
  if (agentKey === "booking") return buildTitanBookingPlan(input) as unknown as Readonly<Record<string, unknown>>;
  if (agentKey === "scheduling") return buildTitanSchedulingPlan(input) as unknown as Readonly<Record<string, unknown>>;
  if (agentKey === "jobs") return buildTitanJobsPlan(input) as unknown as Readonly<Record<string, unknown>>;
  if (agentKey === "customer_care") return buildTitanCustomerCarePlan(input) as unknown as Readonly<Record<string, unknown>>;
  const exhaustive: never = agentKey;
  throw new Error(`unsupported-workflow-agent:${String(exhaustive)}`);
}

function isMutatingPlan(plan: Readonly<Record<string, unknown>>): boolean {
  const operation = plan.operation;
  return Boolean(operation && typeof operation === "object" && !Array.isArray(operation) && (operation as { mutating?: unknown }).mutating === true);
}

function validateHandoffEdges(steps: readonly TitanNativeWorkflowStep[]): void {
  for (let index = 1; index < steps.length; index += 1) {
    const previous = steps[index - 1];
    const next = steps[index];
    if (previous.agentKey === next.agentKey) continue;
    const map = getTitanNativeWorkforceAgentMap(previous.agentKey);
    if (!map?.handoffTargets.includes(next.agentKey)) {
      throw new Error(`workflow-handoff-not-declared:${previous.agentKey}->${next.agentKey}`);
    }
  }
}

export function buildTitanNativeWorkflowPlan(definition: TitanNativeWorkflowDefinition): TitanNativeWorkflowPlan {
  const company_id = assertTitanNativeWorkforceBoundary(definition.companyId);
  const workflow_id = safeId(definition.workflowId, "workflow-id-required");
  const idempotency_key = safeId(definition.idempotencyKey, "workflow-idempotency-key-required");
  const actor_id = clean(definition.actorId, 128) || null;
  const trace_id = clean(definition.traceId, 180) || null;
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) throw new Error("workflow-steps-required");
  if (definition.steps.length > 24) throw new Error("workflow-step-limit-exceeded");

  const seen = new Set<string>();
  for (const step of definition.steps) {
    const stepId = safeId(step.id, "workflow-step-id-required");
    if (seen.has(stepId)) throw new Error(`workflow-duplicate-step-id:${stepId}`);
    seen.add(stepId);
    if (!getTitanNativeWorkforceAgentMap(step.agentKey)) throw new Error(`workflow-agent-unavailable:${step.agentKey}`);
  }
  validateHandoffEdges(definition.steps);

  const steps = definition.steps.map((step, index): TitanNativeWorkflowPlannedStep => {
    const stepId = safeId(step.id, "workflow-step-id-required");
    const rawInput = freezeRecord(step.input);
    for (const key of ["companyId", "company_id", "tenant_id", "tenantId", "tenant_company_id", "account_id"]) {
      if (key in rawInput) throw new Error(`workflow-step-company-boundary-owned:${key}`);
    }
    const plan = buildAgentPlan(step.agentKey, company_id, actor_id, rawInput);
    if (String(plan.company_id ?? "") !== company_id) throw new Error(`workflow-cross-company-plan:${stepId}`);
    let compensation: TitanNativeWorkflowPlannedStep["compensation"] = null;
    if (step.compensation) {
      const compensationInput = freezeRecord(step.compensation.input);
      for (const key of ["companyId", "company_id", "tenant_id", "tenantId", "tenant_company_id", "account_id"]) {
        if (key in compensationInput) throw new Error(`workflow-compensation-company-boundary-owned:${key}`);
      }
      const compensationPlan = buildAgentPlan(step.compensation.agentKey, company_id, actor_id, compensationInput);
      if (String(compensationPlan.company_id ?? "") !== company_id) throw new Error(`workflow-cross-company-compensation:${stepId}`);
      compensation = Object.freeze({
        agentKey: step.compensation.agentKey,
        idempotencyKey: `${idempotency_key}:${stepId}:compensate`,
        plan: compensationPlan,
        mutating: isMutatingPlan(compensationPlan),
      });
    }
    return Object.freeze({
      index,
      id: stepId,
      agentKey: step.agentKey,
      idempotencyKey: `${idempotency_key}:${stepId}`,
      plan,
      mutating: isMutatingPlan(plan),
      compensation,
    });
  });

  return Object.freeze({
    schema: "titan.zero.workforce-native.workflow-plan/v1",
    workflow_id,
    company_id,
    actor_id,
    trace_id,
    idempotency_key,
    steps: Object.freeze(steps),
    authority: Object.freeze({
      identity_grants_authority: false,
      execution_permitted: false,
      per_step_authorization_required: true,
      compensation_requires_authorization: true,
    }),
    execution_model: Object.freeze({
      sequential: true,
      stop_on_failure: true,
      retries_require_same_idempotency_key: true,
      automatic_compensation: false,
      explicit_compensation_only: true,
      delegation_runtime_owned_elsewhere: true,
    }),
  });
}

async function authorized(executor: TitanNativeWorkflowExecutor, plan: TitanNativeWorkflowPlan, step: TitanNativeWorkflowPlannedStep, compensation: boolean, agentKey: TitanNativeWorkforceAgentKey, payload: Readonly<Record<string, unknown>>): Promise<boolean> {
  return Boolean(await executor.authorize({
    company_id: plan.company_id,
    actor_id: plan.actor_id,
    workflow_id: plan.workflow_id,
    step_id: step.id,
    agent_key: agentKey,
    plan: payload,
    compensation,
  }));
}

export async function executeTitanNativeWorkflow(input: Readonly<{
  plan: TitanNativeWorkflowPlan;
  ledger: TitanNativeWorkflowLedger;
  executor: TitanNativeWorkflowExecutor;
  compensateOnFailure?: boolean;
}>): Promise<TitanNativeWorkflowExecutionResult> {
  const { plan, ledger, executor } = input;
  const receipts: TitanNativeWorkflowReceipt[] = [];
  const completed: TitanNativeWorkflowPlannedStep[] = [];
  let failedStepId: string | null = null;
  let terminalStatus: TitanNativeWorkflowExecutionResult["status"] = "SUCCEEDED";

  for (const step of plan.steps) {
    const prior = await ledger.get(step.idempotencyKey);
    if (prior?.status === "SUCCEEDED" || prior?.status === "COMPENSATED") {
      receipts.push(Object.freeze({ idempotencyKey: step.idempotencyKey, status: "SKIPPED_DUPLICATE", result: prior.result ?? null, error: null }));
      completed.push(step);
      continue;
    }
    if (!(await authorized(executor, plan, step, false, step.agentKey, step.plan))) {
      const receipt = Object.freeze({ idempotencyKey: step.idempotencyKey, status: "FAILED" as const, error: "authorization-denied" });
      await ledger.put(receipt); receipts.push(receipt); failedStepId = step.id; terminalStatus = "FAILED_AUTHORIZATION"; break;
    }
    try {
      const result = await executor.execute({ company_id: plan.company_id, actor_id: plan.actor_id, workflow_id: plan.workflow_id, step_id: step.id, agent_key: step.agentKey, idempotency_key: step.idempotencyKey, plan: step.plan, compensation: false });
      const receipt = Object.freeze({ idempotencyKey: step.idempotencyKey, status: "SUCCEEDED" as const, result, error: null });
      await ledger.put(receipt); receipts.push(receipt); completed.push(step);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const receipt = Object.freeze({ idempotencyKey: step.idempotencyKey, status: "FAILED" as const, error: message });
      await ledger.put(receipt); receipts.push(receipt); failedStepId = step.id; terminalStatus = completed.length ? "PARTIAL_FAILURE" : "PARTIAL_FAILURE"; break;
    }
  }

  let compensationAttempted = false;
  let compensationComplete = true;
  if (failedStepId && input.compensateOnFailure === true) {
    compensationAttempted = true;
    for (const step of [...completed].reverse()) {
      const compensation = step.compensation;
      if (!compensation) continue;
      const prior = await ledger.get(compensation.idempotencyKey);
      if (prior?.status === "COMPENSATED" || prior?.status === "SUCCEEDED") {
        receipts.push(Object.freeze({ idempotencyKey: compensation.idempotencyKey, status: "SKIPPED_DUPLICATE", result: prior.result ?? null, error: null }));
        continue;
      }
      if (!(await authorized(executor, plan, step, true, compensation.agentKey, compensation.plan))) {
        const receipt = Object.freeze({ idempotencyKey: compensation.idempotencyKey, status: "COMPENSATION_FAILED" as const, error: "authorization-denied" });
        await ledger.put(receipt); receipts.push(receipt); compensationComplete = false; continue;
      }
      try {
        const result = await executor.execute({ company_id: plan.company_id, actor_id: plan.actor_id, workflow_id: plan.workflow_id, step_id: step.id, agent_key: compensation.agentKey, idempotency_key: compensation.idempotencyKey, plan: compensation.plan, compensation: true });
        const receipt = Object.freeze({ idempotencyKey: compensation.idempotencyKey, status: "COMPENSATED" as const, result, error: null });
        await ledger.put(receipt); receipts.push(receipt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const receipt = Object.freeze({ idempotencyKey: compensation.idempotencyKey, status: "COMPENSATION_FAILED" as const, error: message });
        await ledger.put(receipt); receipts.push(receipt); compensationComplete = false;
      }
    }
    terminalStatus = compensationComplete ? "COMPENSATED" : "COMPENSATION_FAILED";
  }

  return Object.freeze({
    schema: "titan.zero.workforce-native.workflow-result/v1",
    workflow_id: plan.workflow_id,
    company_id: plan.company_id,
    status: terminalStatus,
    receipts: Object.freeze(receipts),
    failed_step_id: failedStepId,
    compensation_attempted: compensationAttempted,
    compensation_complete: compensationComplete,
  });
}
