import type {
  RetrieverExecutionGateInput,
  RetrieverNativeHandlerInput,
  RetrieverNativeRequest,
} from "./contracts.js";
import { createRetrieverNativeExecutor } from "./executor.js";

export const RETRIEVER_NATIVE_LIFECYCLE_SCHEMA = "titan-zero-retriever-native-lifecycle/v1";

export type RetrieverLifecycleState =
  | "submitted"
  | "running"
  | "completed"
  | "cancelled"
  | "timed_out";

export type RetrieverLifecycleRecord = Readonly<{
  schema: typeof RETRIEVER_NATIVE_LIFECYCLE_SCHEMA;
  company_id: string;
  work_id: string;
  state: RetrieverLifecycleState;
  revision: number;
  created_at: number;
  updated_at: number;
  deadline_at: number | null;
  correlation_id: string | null;
  operation_id: string | null;
  idempotency_key: string | null;
  execution_authority: false;
  identity_grants_authority: false;
}>;

export const RETRIEVER_LIFECYCLE_CHECKPOINT_SCHEMA = "titan-zero-retriever-lifecycle-checkpoint/v1";

export type RetrieverLifecycleCheckpoint = Readonly<{
  schema: typeof RETRIEVER_LIFECYCLE_CHECKPOINT_SCHEMA;
  company_id: string;
  records: readonly RetrieverLifecycleRecord[];
  created_at: number;
  identity_grants_authority: false;
  execution_authority: false;
}>;

type LifecycleMutationInput = Readonly<{
  company_id: string;
  tenant_id?: never;
  tenant_company_id?: never;
  work_id: string;
  correlation_id?: string;
  operation_id?: string;
  idempotency_key?: string;
  actor_id?: string | null;
  device_id?: string | null;
  source?: string;
  payload?: unknown;
  execution_gate: RetrieverExecutionGateInput;
  timeout_ms?: number;
}>;

type LifecycleLookupInput = Readonly<{
  company_id: string;
  tenant_id?: never;
  tenant_company_id?: never;
  work_id: string;
}>;

type RetrieverExecutor = ReturnType<typeof createRetrieverNativeExecutor>;

const clean = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function rejectLegacyBoundary(input: object): void {
  if ("tenant_id" in input || "tenant_company_id" in input) {
    throw new TypeError("legacy tenant boundaries are not accepted by native Retriever lifecycle");
  }
}

function requireCompanyId(value: unknown): string {
  const companyId = clean(value);
  if (!companyId) throw new TypeError("company_id is required");
  return companyId;
}

function requireWorkId(value: unknown): string {
  const workId = clean(value);
  if (!workId) throw new TypeError("work_id is required");
  return workId;
}

function key(companyId: string, workId: string): string {
  return `${companyId}\u0000${workId}`;
}

function cloneRecord(record: RetrieverLifecycleRecord): RetrieverLifecycleRecord {
  return Object.freeze({ ...record });
}

function isTerminal(state: RetrieverLifecycleState): boolean {
  return state === "completed" || state === "cancelled" || state === "timed_out";
}

export function createRetrieverNativeLifecycle(options: {
  executor: RetrieverExecutor;
  now?: () => number;
  defaultTimeoutMs?: number;
}) {
  const executor = options?.executor;
  if (!executor || typeof executor.execute !== "function") {
    throw new TypeError("native Retriever executor is required");
  }
  const now = options.now ?? Date.now;
  const defaultTimeoutMs = Number.isFinite(options.defaultTimeoutMs)
    ? Math.max(0, Number(options.defaultTimeoutMs))
    : 300_000;
  const records = new Map<string, RetrieverLifecycleRecord>();

  function locate(input: LifecycleLookupInput): RetrieverLifecycleRecord {
    if (!input || typeof input !== "object") throw new TypeError("lifecycle lookup must be an object");
    rejectLegacyBoundary(input);
    const companyId = requireCompanyId(input.company_id);
    const workId = requireWorkId(input.work_id);
    const record = records.get(key(companyId, workId));
    if (!record) throw new Error("Retriever lifecycle record not found");
    return record;
  }

  function store(
    previous: RetrieverLifecycleRecord | null,
    input: LifecycleMutationInput,
    state: RetrieverLifecycleState,
    deadlineAt: number | null = previous?.deadline_at ?? null,
  ): RetrieverLifecycleRecord {
    const currentTime = now();
    const record: RetrieverLifecycleRecord = Object.freeze({
      schema: RETRIEVER_NATIVE_LIFECYCLE_SCHEMA,
      company_id: requireCompanyId(input.company_id),
      work_id: requireWorkId(input.work_id),
      state,
      revision: (previous?.revision ?? 0) + 1,
      created_at: previous?.created_at ?? currentTime,
      updated_at: currentTime,
      deadline_at: deadlineAt,
      correlation_id: clean(input.correlation_id) ?? previous?.correlation_id ?? null,
      operation_id: clean(input.operation_id) ?? previous?.operation_id ?? null,
      idempotency_key: clean(input.idempotency_key) ?? previous?.idempotency_key ?? null,
      execution_authority: false,
      identity_grants_authority: false,
    });
    records.set(key(record.company_id, record.work_id), record);
    return record;
  }

  function nativeRequest(
    input: LifecycleMutationInput,
    capability: RetrieverNativeRequest["capability"],
    payload: unknown,
  ): RetrieverNativeRequest {
    return {
      company_id: requireCompanyId(input.company_id),
      work_id: requireWorkId(input.work_id),
      correlation_id: clean(input.correlation_id) ?? undefined,
      operation_id: clean(input.operation_id) ?? undefined,
      idempotency_key: clean(input.idempotency_key) ?? undefined,
      actor_id: input.actor_id ?? null,
      device_id: input.device_id ?? null,
      source: clean(input.source) ?? "titan-retriever-lifecycle",
      payload,
      execution_gate: input.execution_gate,
      capability,
    };
  }

  function authorize(
    input: LifecycleMutationInput,
    capability: RetrieverNativeRequest["capability"],
    payload: unknown,
  ): void {
    executor.prepare(nativeRequest(input, capability, payload));
  }

  async function submit(input: LifecycleMutationInput) {
    if (!input || typeof input !== "object") throw new TypeError("lifecycle submission must be an object");
    rejectLegacyBoundary(input);
    authorize(input, "work_submission", input.payload ?? null);
    const companyId = requireCompanyId(input.company_id);
    const workId = requireWorkId(input.work_id);
    const existing = records.get(key(companyId, workId));
    if (existing) {
      const incomingIdem = clean(input.idempotency_key);
      if (
        existing.idempotency_key &&
        incomingIdem &&
        existing.idempotency_key === incomingIdem
      ) return cloneRecord(existing);
      throw new Error("Retriever work_id already exists for company");
    }

    await executor.execute(nativeRequest(input, "work_submission", input.payload ?? null));
    const timeoutMs = Number.isFinite(input.timeout_ms)
      ? Math.max(0, Number(input.timeout_ms))
      : defaultTimeoutMs;
    const deadlineAt = timeoutMs > 0 ? now() + timeoutMs : null;
    return cloneRecord(store(null, input, "submitted", deadlineAt));
  }

  async function progress(input: LifecycleMutationInput) {
    authorize(input, "progress_observation", input.payload ?? null);
    const current = locate(input);
    if (isTerminal(current.state)) throw new Error("Retriever lifecycle record is terminal");
    await executor.execute(nativeRequest(input, "progress_observation", input.payload ?? null));
    return cloneRecord(store(current, input, "running"));
  }

  async function complete(input: LifecycleMutationInput) {
    authorize(input, "result_delivery", input.payload ?? null);
    const current = locate(input);
    if (current.state === "completed") return cloneRecord(current);
    if (isTerminal(current.state)) throw new Error("Retriever lifecycle record is terminal");
    await executor.execute(nativeRequest(input, "result_delivery", input.payload ?? null));
    return cloneRecord(store(current, input, "completed"));
  }

  async function cancel(input: LifecycleMutationInput) {
    authorize(input, "cancellation", input.payload ?? { reason: "cancelled" });
    const current = locate(input);
    if (current.state === "cancelled") return cloneRecord(current);
    if (isTerminal(current.state)) throw new Error("Retriever lifecycle record is terminal");
    await executor.execute(nativeRequest(input, "cancellation", input.payload ?? { reason: "cancelled" }));
    return cloneRecord(store(current, input, "cancelled"));
  }

  async function timeout(input: LifecycleMutationInput) {
    authorize(input, "cancellation", {
      reason: "timeout",
    });
    const current = locate(input);
    if (current.state === "timed_out") return cloneRecord(current);
    if (isTerminal(current.state)) throw new Error("Retriever lifecycle record is terminal");
    if (current.deadline_at == null || now() <= current.deadline_at) {
      throw new Error("Retriever lifecycle deadline has not expired");
    }
    await executor.execute(
      nativeRequest(input, "cancellation", {
        reason: "timeout",
        deadline_at: current.deadline_at,
      }),
    );
    return cloneRecord(store(current, input, "timed_out"));
  }

  function get(input: LifecycleLookupInput) {
    return cloneRecord(locate(input));
  }

  function checkpoint(input: { company_id: string; tenant_id?: never; tenant_company_id?: never }): RetrieverLifecycleCheckpoint {
    if (!input || typeof input !== "object") throw new TypeError("checkpoint input must be an object");
    rejectLegacyBoundary(input);
    const companyId = requireCompanyId(input.company_id);
    const companyRecords = [...records.values()]
      .filter((record) => record.company_id === companyId)
      .map(cloneRecord);
    return Object.freeze({
      schema: RETRIEVER_LIFECYCLE_CHECKPOINT_SCHEMA,
      company_id: companyId,
      records: Object.freeze(companyRecords),
      created_at: now(),
      identity_grants_authority: false,
      execution_authority: false,
    });
  }

  function restore(
    checkpointInput: RetrieverLifecycleCheckpoint & Record<string, unknown>,
    options: { company_id?: string } = {},
  ) {
    if (!checkpointInput || typeof checkpointInput !== "object") {
      throw new TypeError("valid Retriever lifecycle checkpoint is required");
    }
    rejectLegacyBoundary(checkpointInput);
    if (checkpointInput.schema !== RETRIEVER_LIFECYCLE_CHECKPOINT_SCHEMA) {
      throw new TypeError("valid Retriever lifecycle checkpoint is required");
    }
    const companyId = requireCompanyId(checkpointInput.company_id);
    const expected = clean(options.company_id);
    if (expected && expected !== companyId) throw new TypeError("checkpoint company_id mismatch");
    if (!Array.isArray(checkpointInput.records)) throw new TypeError("checkpoint records are required");

    let restored = 0;
    for (const candidate of checkpointInput.records) {
      if (!candidate || typeof candidate !== "object") throw new TypeError("invalid checkpoint record");
      if (candidate.company_id !== companyId) throw new TypeError("checkpoint record company_id mismatch");
      if (candidate.execution_authority !== false || candidate.identity_grants_authority !== false) {
        throw new TypeError("checkpoint cannot restore execution authority");
      }
      const workId = requireWorkId(candidate.work_id);
      const state = candidate.state;
      if (!["submitted", "running", "completed", "cancelled", "timed_out"].includes(state)) {
        throw new TypeError("invalid checkpoint lifecycle state");
      }
      const record: RetrieverLifecycleRecord = Object.freeze({
        ...candidate,
        schema: RETRIEVER_NATIVE_LIFECYCLE_SCHEMA,
        company_id: companyId,
        work_id: workId,
        execution_authority: false,
        identity_grants_authority: false,
      });
      records.set(key(companyId, workId), record);
      restored += 1;
    }

    return Object.freeze({
      schema: "titan-zero-retriever-lifecycle-restore/v1",
      company_id: companyId,
      restored,
      authority_restored: false,
      identity_grants_authority: false,
      execution_authority: false,
    });
  }

  return Object.freeze({
    schema: RETRIEVER_NATIVE_LIFECYCLE_SCHEMA,
    company_boundary: "company_id",
    identity_grants_authority: false,
    execution_authority: false,
    submit,
    progress,
    complete,
    cancel,
    timeout,
    get,
    checkpoint,
    restore,
  });
}
