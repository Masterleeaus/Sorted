import {
  assertNoLegacyStorageBoundary,
  normalizeStorageContext,
  type StorageContextInput,
  type StorageRecord,
} from "../storage/contracts.js";

type Repository = Readonly<{
  get(context: StorageContextInput, module_id: string, collection: string, record_id: string): Promise<StorageRecord | null>;
  put(context: StorageContextInput, input: Readonly<{
    module_id: string;
    collection: string;
    record_id: string;
    expected_revision?: number;
    data?: unknown;
  }>): Promise<StorageRecord>;
  list(context: StorageContextInput, query?: Readonly<{ module_id?: string; collection?: string }>): Promise<readonly StorageRecord[]>;
  transaction<T>(
    context: StorageContextInput,
    work: (repository: Repository, context: ReturnType<typeof normalizeStorageContext>) => Promise<T>,
  ): Promise<T>;
}>;

const MODULE_ID = "titan.offline";
const COLLECTION = "operation-receipts";
const SAFE = /^[^\u0000-\u001f\u007f]{1,256}$/;
const TERMINAL = new Set(["committed", "acknowledged", "failed", "cancelled"]);

function text(value: unknown, field: string): string {
  const out = String(value ?? "").trim();
  if (!SAFE.test(out)) throw new Error(`${field} is required and must be 1-256 printable characters`);
  return out;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value === undefined ? "__titan_undefined__" : value;
}

function fingerprint(value: unknown): string {
  const input = JSON.stringify(stable(value)) || "";
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return `${input.length}-${(hash >>> 0).toString(16)}`;
}

function receiptId(operation_id: string): string {
  return operation_id;
}

function assertCompany(value: unknown, company_id: string, path = "offline-operation"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCompany(item, company_id, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "company_id" && child != null && String(child).trim() !== company_id) {
      throw new Error(`Cross-company offline mutation rejected at ${path}.company_id`);
    }
    assertCompany(child, company_id, `${path}.${key}`);
  }
}

export type OfflineMutationIdentity = Readonly<{
  company_id: string;
  operation_id: string;
  idempotency_key: string;
  mutation_kind: string;
  target: string;
  payload_fingerprint: string;
}>;

export function createOfflineOperationIdentity(
  contextInput: StorageContextInput,
  input: Readonly<{
    operation_id?: string;
    idempotency_key?: string;
    mutation_kind: string;
    target: string;
    payload?: unknown;
  }>,
): OfflineMutationIdentity {
  assertNoLegacyStorageBoundary(input, "offline-operation");
  const context = normalizeStorageContext(contextInput);
  assertCompany(input, context.company_id);
  const operation_id = text(input.operation_id ?? context.operation_id, "operation_id");
  const idempotency_key = text(input.idempotency_key ?? context.idempotency_key, "idempotency_key");
  const mutation_kind = text(input.mutation_kind, "mutation_kind").toLowerCase();
  const target = text(input.target, "target");
  const payload_fingerprint = fingerprint({
    company_id: context.company_id,
    operation_id,
    mutation_kind,
    target,
    payload: stable(input.payload ?? null),
  });
  return Object.freeze({
    company_id: context.company_id,
    operation_id,
    idempotency_key,
    mutation_kind,
    target,
    payload_fingerprint,
  });
}

export function createOfflineOperationRegistry({
  repository,
  clock = () => Date.now(),
}: {
  repository: Repository;
  clock?: () => number;
}) {
  if (!repository?.get || !repository?.put || typeof repository.transaction !== "function") {
    throw new Error("Transaction-capable canonical Titan repository is required for offline operations");
  }

  const descriptor = Object.freeze({
    protocol: "titan.offline.operation-identity.v1" as const,
    company_boundary: "company_id" as const,
    deterministic_identity: true,
    idempotency_required: true,
    duplicate_delivery_safe: true,
    automatic_effect_replay: false,
    identity_grants_authority: false,
    execution_authority: false,
  });

  async function get(contextInput: StorageContextInput, operation_id: string) {
    const context = normalizeStorageContext(contextInput);
    const row = await repository.get(context, MODULE_ID, COLLECTION, receiptId(text(operation_id, "operation_id")));
    return row?.data ? structuredClone(row.data as object) as any : null;
  }

  return Object.freeze({
    descriptor,
    get,

    async prepare(
      contextInput: StorageContextInput,
      input: Readonly<{
        operation_id?: string;
        idempotency_key?: string;
        mutation_kind: string;
        target: string;
        payload?: unknown;
      }>,
    ) {
      const identity = createOfflineOperationIdentity(contextInput, input);
      const context = normalizeStorageContext({
        ...contextInput,
        company_id: identity.company_id,
        operation_id: identity.operation_id,
        idempotency_key: null,
      });

      return repository.transaction(context, async (tx, txContext) => {
        const storageContext = Object.freeze({ ...txContext, idempotency_key: null });
        const prior = await tx.get(storageContext, MODULE_ID, COLLECTION, receiptId(identity.operation_id));
        const priorData = prior?.data as any;

        if (priorData) {
          const sameIdentity =
            priorData.idempotency_key === identity.idempotency_key &&
            priorData.payload_fingerprint === identity.payload_fingerprint &&
            priorData.mutation_kind === identity.mutation_kind &&
            priorData.target === identity.target;

          if (sameIdentity) {
            return Object.freeze({
              status: "duplicate" as const,
              duplicate: true,
              conflict: false,
              receipt: structuredClone(priorData),
            });
          }

          const reason =
            priorData.idempotency_key === identity.idempotency_key
              ? "idempotency_key_reused"
              : "operation_id_reused";
          return Object.freeze({
            status: "conflict" as const,
            duplicate: false,
            conflict: true,
            reason,
            prior: structuredClone(priorData),
            attempted_identity: identity,
            grants_authority: false,
          });
        }

        const now = Number(clock());
        const receipt = Object.freeze({
          schema: "titan.offline.operation-receipt.v1",
          ...identity,
          state: "prepared" as const,
          terminal: false,
          attempt: 1,
          prepared_at: now,
          updated_at: now,
          submitted_at: null,
          acknowledged_at: null,
          committed_at: null,
          error: null,
          automatic_effect_replay: false,
          effect_replay_allowed: false,
          authority_neutral: true,
          grants_authority: false,
        });

        await tx.put(storageContext, {
          module_id: MODULE_ID,
          collection: COLLECTION,
          record_id: receiptId(identity.operation_id),
          data: receipt,
        });

        return Object.freeze({
          status: "prepared" as const,
          duplicate: false,
          conflict: false,
          receipt,
        });
      });
    },

    async transition(
      contextInput: StorageContextInput,
      operationId: string,
      nextStateInput: string,
      patch: Readonly<Record<string, unknown>> = {},
    ) {
      assertNoLegacyStorageBoundary(patch, "offline-operation-transition");
      const context = normalizeStorageContext(contextInput);
      assertCompany(patch, context.company_id, "offline-operation-transition");
      const operation_id = text(operationId, "operation_id");
      const nextState = text(nextStateInput, "state").toLowerCase();
      const allowed = new Set(["prepared", "queued", "submitted", "acknowledged", "committed", "failed", "cancelled"]);
      if (!allowed.has(nextState)) throw new Error(`Unsupported offline operation state: ${nextState}`);

      return repository.transaction(
        { ...context, operation_id, idempotency_key: null },
        async (tx, txContext) => {
          const storageContext = Object.freeze({ ...txContext, idempotency_key: null });
          const prior = await tx.get(storageContext, MODULE_ID, COLLECTION, receiptId(operation_id));
          if (!prior?.data) throw new Error("offline-operation-receipt-not-found");
          const data = prior.data as any;
          if (data.company_id !== txContext.company_id) throw new Error("Cross-company offline operation receipt rejected");
          if (data.terminal && nextState !== data.state) throw new Error("offline-operation-terminal");

          const now = Number(clock());
          const stamps: Record<string, number> = {};
          if (nextState === "submitted") stamps.submitted_at = now;
          if (nextState === "acknowledged") stamps.acknowledged_at = now;
          if (nextState === "committed") stamps.committed_at = now;

          const next = Object.freeze({
            ...structuredClone(data),
            ...structuredClone(patch),
            ...stamps,
            company_id: txContext.company_id,
            operation_id,
            state: nextState,
            terminal: TERMINAL.has(nextState),
            updated_at: now,
            automatic_effect_replay: false,
            effect_replay_allowed: false,
            authority_neutral: true,
            grants_authority: false,
          });

          await tx.put(storageContext, {
            module_id: MODULE_ID,
            collection: COLLECTION,
            record_id: receiptId(operation_id),
            expected_revision: prior.version,
            data: next,
          });
          return next;
        },
      );
    },

    async list(contextInput: StorageContextInput, options: Readonly<{ state?: string }> = {}) {
      const context = normalizeStorageContext(contextInput);
      const rows = await repository.list(context, { module_id: MODULE_ID, collection: COLLECTION });
      return rows
        .map((row) => structuredClone(row.data as object) as any)
        .filter((row) => options.state == null || row.state === options.state);
    },
  });
}

export const OFFLINE_OPERATION_MODULE_ID = MODULE_ID;
export const OFFLINE_OPERATION_COLLECTION = COLLECTION;
