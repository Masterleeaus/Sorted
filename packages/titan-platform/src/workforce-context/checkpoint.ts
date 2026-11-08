import type { WorkforceContextProjection } from "./projection.js";

export const WORKFORCE_TASK_CHECKPOINT_SCHEMA = "titan.workforce.task-checkpoint/v1" as const;

export type WorkforceTaskCheckpointState = "active" | "paused" | "blocked" | "completed";

export type WorkforceTaskCheckpoint = Readonly<{
  schema: typeof WORKFORCE_TASK_CHECKPOINT_SCHEMA;
  company_id: string;
  task_id: string;
  objective_id: string;
  worker_id: string;
  correlation_id: string | null;
  checkpoint_revision: number;
  state: WorkforceTaskCheckpointState;
  step: string | null;
  completed_steps: readonly string[];
  pending_operation_ids: readonly string[];
  last_event_id: string | null;
  source_versions: readonly Readonly<{
    kind: string;
    id: string;
    version: string | number | null;
  }>[];
  updated_at: string;
  policies: Readonly<{
    task_local_only: true;
    canonical_records_remain_source_of_truth: true;
    checkpoint_contains_no_business_payload: true;
    restart_safe: true;
    offline_safe: true;
    checkpoint_is_not_authority: true;
  }>;
}>;

export type CreateWorkforceTaskCheckpointInput = Readonly<{
  projection: WorkforceContextProjection;
  checkpoint_revision?: number;
  state?: WorkforceTaskCheckpointState;
  step?: string | null;
  completed_steps?: readonly string[];
  pending_operation_ids?: readonly string[];
  last_event_id?: string | null;
  updated_at?: string;
  business_payload?: never;
  customer_payload?: never;
  job_payload?: never;
  workflow_payload?: never;
  tenant_id?: never;
  tenant_company_id?: never;
}>;

export type RestoreWorkforceTaskCheckpointExpectation = Readonly<{
  company_id: string;
  task_id: string;
  worker_id: string;
}>;

function requireNonEmpty(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function normalizeUnique(values: readonly string[] | undefined, field: string): readonly string[] {
  const normalized = (values ?? []).map((value) => requireNonEmpty(value, field));
  return Object.freeze([...new Set(normalized)]);
}

function requireRevision(value: number | undefined): number {
  const revision = value ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new TypeError("checkpoint_revision must be a positive safe integer");
  }
  return revision;
}

function requireIsoTimestamp(value: string | undefined): string {
  const timestamp = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) throw new TypeError("updated_at must be a valid timestamp");
  return timestamp;
}

function assertNoPayloadOrLegacyAliases(input: object): void {
  const forbidden = [
    "business_payload",
    "customer_payload",
    "job_payload",
    "workflow_payload",
    "tenant_id",
    "tenant_company_id",
  ];
  for (const key of forbidden) {
    if (key in input) throw new TypeError(`${key} is not allowed in a workforce task checkpoint`);
  }
}

function assertState(value: string): asserts value is WorkforceTaskCheckpointState {
  if (!["active", "paused", "blocked", "completed"].includes(value)) {
    throw new TypeError(`unsupported checkpoint state: ${value}`);
  }
}

/**
 * Create task-local restart/offline state from a least-data projection. The
 * checkpoint persists progress metadata and canonical source versions only;
 * business/customer/job/workflow payloads remain in their authoritative stores.
 */
export function createWorkforceTaskCheckpoint(
  input: CreateWorkforceTaskCheckpointInput,
): WorkforceTaskCheckpoint {
  if (!input || typeof input !== "object") throw new TypeError("checkpoint input is required");
  assertNoPayloadOrLegacyAliases(input);
  const projection = input.projection;
  if (!projection || typeof projection !== "object") throw new TypeError("projection is required");

  const state = input.state ?? "active";
  assertState(state);

  return Object.freeze({
    schema: WORKFORCE_TASK_CHECKPOINT_SCHEMA,
    company_id: requireNonEmpty(projection.company_id, "projection.company_id"),
    task_id: requireNonEmpty(projection.task_id, "projection.task_id"),
    objective_id: requireNonEmpty(projection.objective_id, "projection.objective_id"),
    worker_id: requireNonEmpty(projection.worker_id, "projection.worker_id"),
    correlation_id: projection.correlation_id ?? null,
    checkpoint_revision: requireRevision(input.checkpoint_revision),
    state,
    step: input.step ? requireNonEmpty(input.step, "step") : null,
    completed_steps: normalizeUnique(input.completed_steps, "completed_steps entry"),
    pending_operation_ids: normalizeUnique(input.pending_operation_ids, "pending_operation_ids entry"),
    last_event_id: input.last_event_id ? requireNonEmpty(input.last_event_id, "last_event_id") : null,
    source_versions: Object.freeze(projection.sources.map((source) => Object.freeze({
      kind: source.kind,
      id: source.id,
      version: source.version ?? null,
    }))),
    updated_at: requireIsoTimestamp(input.updated_at),
    policies: Object.freeze({
      task_local_only: true,
      canonical_records_remain_source_of_truth: true,
      checkpoint_contains_no_business_payload: true,
      restart_safe: true,
      offline_safe: true,
      checkpoint_is_not_authority: true,
    }),
  });
}

/** Validate a deserialized checkpoint before restart/offline resume. */
export function restoreWorkforceTaskCheckpoint(
  candidate: unknown,
  expected: RestoreWorkforceTaskCheckpointExpectation,
): WorkforceTaskCheckpoint {
  if (!candidate || typeof candidate !== "object") throw new TypeError("checkpoint is required");
  const checkpoint = candidate as WorkforceTaskCheckpoint;
  if (checkpoint.schema !== WORKFORCE_TASK_CHECKPOINT_SCHEMA) throw new TypeError("unsupported checkpoint schema");

  const expectedCompany = requireNonEmpty(expected.company_id, "expected.company_id");
  const expectedTask = requireNonEmpty(expected.task_id, "expected.task_id");
  const expectedWorker = requireNonEmpty(expected.worker_id, "expected.worker_id");
  if (checkpoint.company_id !== expectedCompany) throw new TypeError("checkpoint company_id mismatch");
  if (checkpoint.task_id !== expectedTask) throw new TypeError("checkpoint task_id mismatch");
  if (checkpoint.worker_id !== expectedWorker) throw new TypeError("checkpoint worker_id mismatch");

  requireNonEmpty(checkpoint.objective_id, "checkpoint.objective_id");
  requireRevision(checkpoint.checkpoint_revision);
  assertState(checkpoint.state);
  requireIsoTimestamp(checkpoint.updated_at);
  if (!checkpoint.policies?.checkpoint_contains_no_business_payload || !checkpoint.policies?.checkpoint_is_not_authority) {
    throw new TypeError("checkpoint policy guard missing");
  }
  return Object.freeze(checkpoint);
}

/**
 * Advance progress monotonically. Callers must persist the returned checkpoint
 * atomically in their existing device/offline store; this module owns no DB.
 */
export function advanceWorkforceTaskCheckpoint(
  checkpoint: WorkforceTaskCheckpoint,
  patch: Readonly<{
    state?: WorkforceTaskCheckpointState;
    step?: string | null;
    completed_steps?: readonly string[];
    pending_operation_ids?: readonly string[];
    last_event_id?: string | null;
    updated_at?: string;
  }>,
): WorkforceTaskCheckpoint {
  restoreWorkforceTaskCheckpoint(checkpoint, {
    company_id: checkpoint.company_id,
    task_id: checkpoint.task_id,
    worker_id: checkpoint.worker_id,
  });
  const state = patch.state ?? checkpoint.state;
  assertState(state);

  return Object.freeze({
    ...checkpoint,
    checkpoint_revision: checkpoint.checkpoint_revision + 1,
    state,
    step: patch.step === undefined ? checkpoint.step : (patch.step ? requireNonEmpty(patch.step, "step") : null),
    completed_steps: patch.completed_steps === undefined
      ? checkpoint.completed_steps
      : normalizeUnique(patch.completed_steps, "completed_steps entry"),
    pending_operation_ids: patch.pending_operation_ids === undefined
      ? checkpoint.pending_operation_ids
      : normalizeUnique(patch.pending_operation_ids, "pending_operation_ids entry"),
    last_event_id: patch.last_event_id === undefined
      ? checkpoint.last_event_id
      : (patch.last_event_id ? requireNonEmpty(patch.last_event_id, "last_event_id") : null),
    updated_at: requireIsoTimestamp(patch.updated_at),
  });
}
