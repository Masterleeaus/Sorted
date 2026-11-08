import type { TitanBusinessWorkflowRunPlan } from "./runner-contract.js";

export const TITAN_BUSINESS_WORKFLOW_STATE_SCHEMA = "titan.zero.business.workflow-state/v1" as const;

export type TitanBusinessWorkflowStateStatus = "PENDING" | "RUNNING" | "RETRY_WAIT" | "SUCCEEDED" | "FAILED_FINAL";
export type TitanBusinessWorkflowStateEventType = "START" | "SUCCEEDED" | "RETRYABLE_FAILURE" | "FINAL_FAILURE";

export type TitanBusinessWorkflowExecutionState = Readonly<{
  schema: typeof TITAN_BUSINESS_WORKFLOW_STATE_SCHEMA;
  workflow_id: string;
  company_id: string;
  correlation_id: string;
  idempotency_key: string;
  canonical_domain_surface: string;
  revision: number;
  attempt: number;
  max_attempts: number;
  status: TitanBusinessWorkflowStateStatus;
  processed_event_ids: readonly string[];
  result_ref: string | null;
  error_code: string | null;
}>;

function token(value: unknown, code: string, max = 180): string {
  const out = String(value ?? "").trim();
  if (!out || out.length > max || out.includes("/") || out.includes("\\") || out.includes("..")) throw new Error(code);
  return out;
}

function boundedAttempts(value: unknown): number {
  const n = Number(value ?? 3);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new Error("workflow-state-max-attempts-invalid");
  return n;
}

export function createTitanBusinessWorkflowExecutionState(input: Readonly<{
  plan: TitanBusinessWorkflowRunPlan;
  maxAttempts?: number;
}>): TitanBusinessWorkflowExecutionState {
  return Object.freeze({
    schema: TITAN_BUSINESS_WORKFLOW_STATE_SCHEMA,
    workflow_id: input.plan.workflow_id,
    company_id: input.plan.company_id,
    correlation_id: input.plan.correlation_id,
    idempotency_key: input.plan.idempotency_key,
    canonical_domain_surface: input.plan.canonical_domain_surface,
    revision: 0,
    attempt: 0,
    max_attempts: boundedAttempts(input.maxAttempts),
    status: "PENDING",
    processed_event_ids: Object.freeze([]),
    result_ref: null,
    error_code: null,
  });
}

export function assertTitanBusinessWorkflowResume(state: TitanBusinessWorkflowExecutionState, input: Readonly<{
  companyId: string;
  correlationId: string;
  idempotencyKey: string;
}>): TitanBusinessWorkflowExecutionState {
  if (token(input.companyId, "workflow-state-company-required") !== state.company_id) throw new Error("workflow-state-company-mismatch");
  if (token(input.correlationId, "workflow-state-correlation-required") !== state.correlation_id) throw new Error("workflow-state-correlation-mismatch");
  if (token(input.idempotencyKey, "workflow-state-idempotency-required") !== state.idempotency_key) throw new Error("workflow-state-idempotency-mismatch");
  return state;
}

export function transitionTitanBusinessWorkflowExecutionState(input: Readonly<{
  state: TitanBusinessWorkflowExecutionState;
  expectedRevision: number;
  event: Readonly<{
    eventId: string;
    type: TitanBusinessWorkflowStateEventType;
    resultRef?: string | null;
    errorCode?: string | null;
  }>;
}>): TitanBusinessWorkflowExecutionState {
  const state = input.state;
  const eventId = token(input.event.eventId, "workflow-state-event-id-required");
  if (state.processed_event_ids.includes(eventId)) return state;
  if (input.expectedRevision !== state.revision) throw new Error("workflow-state-revision-conflict");
  if (state.status === "SUCCEEDED" || state.status === "FAILED_FINAL") throw new Error("workflow-state-terminal");

  let status: TitanBusinessWorkflowStateStatus = state.status;
  let attempt = state.attempt;
  let result_ref = state.result_ref;
  let error_code = state.error_code;

  switch (input.event.type) {
    case "START":
      if (state.status !== "PENDING" && state.status !== "RETRY_WAIT") throw new Error("workflow-state-start-invalid");
      if (attempt >= state.max_attempts) throw new Error("workflow-state-retry-budget-exhausted");
      attempt += 1;
      status = "RUNNING";
      error_code = null;
      break;
    case "SUCCEEDED":
      if (state.status !== "RUNNING") throw new Error("workflow-state-success-invalid");
      status = "SUCCEEDED";
      result_ref = input.event.resultRef ? token(input.event.resultRef, "workflow-state-result-ref-invalid") : null;
      error_code = null;
      break;
    case "RETRYABLE_FAILURE":
      if (state.status !== "RUNNING") throw new Error("workflow-state-retryable-failure-invalid");
      error_code = token(input.event.errorCode ?? "retryable-failure", "workflow-state-error-code-invalid", 120);
      status = attempt >= state.max_attempts ? "FAILED_FINAL" : "RETRY_WAIT";
      break;
    case "FINAL_FAILURE":
      if (state.status !== "RUNNING") throw new Error("workflow-state-final-failure-invalid");
      status = "FAILED_FINAL";
      error_code = token(input.event.errorCode ?? "final-failure", "workflow-state-error-code-invalid", 120);
      break;
  }

  const processed = Object.freeze([...state.processed_event_ids, eventId].slice(-64));
  return Object.freeze({ ...state, revision: state.revision + 1, attempt, status, processed_event_ids: processed, result_ref, error_code });
}
