import {
  assertNoLegacyStorageBoundary,
  normalizeStorageContext,
  type StorageContextInput,
  type StorageRecord,
} from "./contracts.js";

type CompanyRepository = Readonly<{
  put(context: StorageContextInput, input: Readonly<{
    module_id: string;
    collection: string;
    record_id: string;
    expected_revision?: number;
    data?: unknown;
  }>): Promise<StorageRecord>;
  get(context: StorageContextInput, module_id: string, collection: string, record_id: string): Promise<StorageRecord | null>;
  list(context: StorageContextInput, query?: Readonly<{ module_id?: string; collection?: string }>): Promise<readonly StorageRecord[]>;
}>;

const CHECKPOINT_MODULE = "titan.offline";
const CHECKPOINT_COLLECTION = "restart-checkpoints";
const CONFLICT_MODULE = "titan.storage";
const CONFLICT_COLLECTION = "reconciliation-conflicts";

function clone<T>(value: T): T {
  return value == null ? value : structuredClone(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stableValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function samePayload(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function cleanId(value: unknown, field: string): string {
  const out = String(value ?? "").trim();
  if (!out) throw new Error(`${field} is required`);
  return out;
}

function assertCompanyPayload(value: unknown, company_id: string, path = "value"): void {
  assertNoLegacyStorageBoundary(value, path);
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertCompanyPayload(child, company_id, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "company_id" && child != null && String(child).trim() !== company_id) {
      throw new Error(`Cross-company payload rejected at ${path}.company_id`);
    }
    assertCompanyPayload(child, company_id, `${path}.${key}`);
  }
}

export function createCompanyCheckpointFacade({
  repository,
  company_id,
  actor_id = "titan-offline-storage",
}: {
  repository: CompanyRepository;
  company_id: string;
  actor_id?: string;
}) {
  if (!repository?.put || !repository?.get || !repository?.list) {
    throw new Error("Canonical Titan storage repository is required");
  }
  const bound = normalizeStorageContext({ company_id, actor_id, operation_id: "checkpoint-storage" });

  return Object.freeze({
    company_id: bound.company_id,
    authority_neutral: true,
    grants_authority: false,

    async put({
      operation_id,
      data = {},
      provenance = {},
    }: {
      operation_id: string;
      data?: unknown;
      provenance?: unknown;
    }) {
      const id = cleanId(operation_id, "operation_id");
      assertCompanyPayload(data, bound.company_id, "checkpoint.data");
      assertCompanyPayload(provenance, bound.company_id, "checkpoint.provenance");
      return repository.put(bound, {
        module_id: CHECKPOINT_MODULE,
        collection: CHECKPOINT_COLLECTION,
        record_id: id,
        data: {
          ...(clone(data) as Record<string, unknown>),
          company_id: bound.company_id,
          operation_id: id,
          authority_neutral: true,
          grants_authority: false,
          provenance: clone(provenance),
        },
      });
    },

    async get(operation_id: string) {
      const id = cleanId(operation_id, "operation_id");
      const row = await repository.get(bound, CHECKPOINT_MODULE, CHECKPOINT_COLLECTION, id);
      if (!row) return null;
      if (row.company_id !== bound.company_id) throw new Error("Cross-company checkpoint row rejected");
      assertCompanyPayload(row.data, bound.company_id, "checkpoint.row");
      return clone(row);
    },

    async list() {
      const rows = await repository.list(bound, {
        module_id: CHECKPOINT_MODULE,
        collection: CHECKPOINT_COLLECTION,
      });
      for (const row of rows) {
        if (row.company_id !== bound.company_id) throw new Error("Cross-company checkpoint list rejected");
        assertCompanyPayload(row.data, bound.company_id, "checkpoint.list");
      }
      return rows.map(clone);
    },
  });
}

export function createStorageReconciler({
  repository,
  clock = () => Date.now(),
}: {
  repository: CompanyRepository;
  clock?: () => number;
}) {
  if (!repository?.put || !repository?.get || !repository?.list) {
    throw new Error("Canonical Titan storage repository is required");
  }

  const descriptor = Object.freeze({
    protocol: "titan.storage.reconciliation.v1" as const,
    local_primary: true,
    company_boundary: "company_id" as const,
    conflict_strategy: "explicit_no_silent_overwrite" as const,
    identity_grants_authority: false,
    execution_authority: false,
    server_grants_authority: false,
  });

  async function readLocal(
    contextInput: StorageContextInput,
    module_id: string,
    collection: string,
    record_id: string,
  ) {
    return repository.get(contextInput, module_id, collection, record_id);
  }

  async function recordConflict(
    contextInput: StorageContextInput,
    input: Readonly<{
      module_id: string;
      collection: string;
      record_id: string;
      reason: string;
      local_revision: number;
      remote_revision: number;
      local_payload: unknown;
      remote_payload: unknown;
    }>,
  ) {
    const context = normalizeStorageContext(contextInput);
    const at = Number(clock());
    const conflict_id = `${input.module_id}:${input.collection}:${input.record_id}:${input.local_revision}:${input.remote_revision}:${at}`;
    const conflict = Object.freeze({
      schema: "titan.storage.reconciliation-conflict.v1",
      company_id: context.company_id,
      conflict_id,
      ...clone(input),
      at,
      authority_neutral: true,
      grants_authority: false,
    });
    await repository.put(context, {
      module_id: CONFLICT_MODULE,
      collection: CONFLICT_COLLECTION,
      record_id: conflict_id,
      data: conflict,
    });
    return conflict;
  }

  return Object.freeze({
    descriptor,
    readLocal,

    async writeLocal(
      contextInput: StorageContextInput,
      input: Readonly<{
        module_id: string;
        collection: string;
        record_id: string;
        revision?: number;
        data?: unknown;
        dirty?: boolean;
      }>,
    ) {
      const context = normalizeStorageContext(contextInput);
      assertCompanyPayload(input, context.company_id, "local");
      const current = await repository.get(context, input.module_id, input.collection, input.record_id);
      const currentEnvelope = current?.data as any;
      const requestedRevision = input.revision == null
        ? Number(currentEnvelope?.revision ?? 0) + 1
        : Number(input.revision);
      if (!Number.isInteger(requestedRevision) || requestedRevision < 0) {
        throw new Error("Local revision must be a non-negative integer");
      }
      if (currentEnvelope && requestedRevision < Number(currentEnvelope.revision ?? 0)) {
        throw new Error("Local revision regression rejected");
      }

      return repository.put(context, {
        module_id: input.module_id,
        collection: input.collection,
        record_id: input.record_id,
        expected_revision: current?.version ?? 0,
        data: {
          schema: "titan.storage.local-envelope.v1",
          company_id: context.company_id,
          revision: requestedRevision,
          dirty: input.dirty !== false,
          payload: clone(input.data ?? null),
          updated_at: Number(clock()),
          source: "local-primary",
          authority_neutral: true,
          grants_authority: false,
        },
      });
    },

    async applyRemote(
      contextInput: StorageContextInput,
      input: Readonly<{
        company_id?: string;
        module_id: string;
        collection: string;
        record_id: string;
        revision: number;
        data?: unknown;
      }>,
    ) {
      const context = normalizeStorageContext(contextInput);
      assertCompanyPayload(input, context.company_id, "remote");
      const remoteRevision = Number(input.revision);
      if (!Number.isInteger(remoteRevision) || remoteRevision < 0) {
        throw new Error("Remote revision must be a non-negative integer");
      }

      const current = await repository.get(context, input.module_id, input.collection, input.record_id);
      const local = current?.data as any;
      const localRevision = Number(local?.revision ?? 0);
      const localDirty = Boolean(local?.dirty);

      if (!current) {
        const record = await repository.put(context, {
          module_id: input.module_id,
          collection: input.collection,
          record_id: input.record_id,
          data: {
            schema: "titan.storage.local-envelope.v1",
            company_id: context.company_id,
            revision: remoteRevision,
            dirty: false,
            payload: clone(input.data ?? null),
            updated_at: Number(clock()),
            source: "server-reconciliation",
            authority_neutral: true,
            grants_authority: false,
          },
        });
        return Object.freeze({ status: "remote_applied" as const, record });
      }

      if (remoteRevision < localRevision) {
        return Object.freeze({ status: "remote_stale" as const, record: current });
      }

      if (remoteRevision === localRevision) {
        if (!samePayload(local?.payload, input.data ?? null)) {
          const conflict = await recordConflict(context, {
            module_id: input.module_id,
            collection: input.collection,
            record_id: input.record_id,
            reason: "same_revision_divergence",
            local_revision: localRevision,
            remote_revision: remoteRevision,
            local_payload: local?.payload,
            remote_payload: input.data ?? null,
          });
          return Object.freeze({ status: "conflict" as const, conflict, record: current });
        }
        if (!localDirty) {
          return Object.freeze({ status: "already_current" as const, record: current });
        }
        const record = await repository.put(context, {
          module_id: input.module_id,
          collection: input.collection,
          record_id: input.record_id,
          expected_revision: current.version,
          data: {
            ...clone(local),
            dirty: false,
            source: "server-acknowledged",
            updated_at: Number(clock()),
          },
        });
        return Object.freeze({ status: "acknowledged" as const, record });
      }

      if (localDirty) {
        const conflict = await recordConflict(context, {
          module_id: input.module_id,
          collection: input.collection,
          record_id: input.record_id,
          reason: "local_dirty_remote_advanced",
          local_revision: localRevision,
          remote_revision: remoteRevision,
          local_payload: local?.payload,
          remote_payload: input.data ?? null,
        });
        return Object.freeze({ status: "conflict" as const, conflict, record: current });
      }

      const record = await repository.put(context, {
        module_id: input.module_id,
        collection: input.collection,
        record_id: input.record_id,
        expected_revision: current.version,
        data: {
          schema: "titan.storage.local-envelope.v1",
          company_id: context.company_id,
          revision: remoteRevision,
          dirty: false,
          payload: clone(input.data ?? null),
          updated_at: Number(clock()),
          source: "server-reconciliation",
          authority_neutral: true,
          grants_authority: false,
        },
      });
      return Object.freeze({ status: "remote_applied" as const, record });
    },

    async listConflicts(contextInput: StorageContextInput) {
      const context = normalizeStorageContext(contextInput);
      const rows = await repository.list(context, {
        module_id: CONFLICT_MODULE,
        collection: CONFLICT_COLLECTION,
      });
      return rows.map((row) => clone(row.data));
    },
  });
}
