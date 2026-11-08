import {
  STORAGE_PROTOCOL,
  STORAGE_VERSION,
  assertNoLegacyStorageBoundary,
  normalizeStorageContext,
  type StorageAdapter,
  type StorageContextInput,
  type StorageRecord,
} from "./contracts.js";

const SAFE_ID = /^[^\u0000-\u001f\u007f]{1,256}$/;

function cleanPart(value: unknown, field: string, lower = false): string {
  let out = String(value ?? "").trim();
  if (lower) out = out.toLowerCase();
  if (!SAFE_ID.test(out)) throw new Error(`${field} is required and must be 1-256 printable characters`);
  return out;
}

function makePk(company_id: string, module_id: string, collection: string, record_id: string): string {
  return [company_id, module_id, collection, record_id].map(encodeURIComponent).join("|");
}

function idempotencyPk(company_id: string, key: string): string {
  return `${encodeURIComponent(company_id)}|${encodeURIComponent(key)}`;
}

function assertCompanyConsistency(value: unknown, company_id: string, path = "value"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertCompanyConsistency(entry, company_id, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "company_id" && child != null && String(child).trim() !== company_id) {
      throw new Error(`Cross-company payload rejected at ${path}.company_id`);
    }
    assertCompanyConsistency(child, company_id, `${path}.${key}`);
  }
}

export function createCompanyRepository({
  adapter,
  clock = () => Date.now(),
}: {
  adapter: StorageAdapter;
  clock?: () => number;
}) {
  if (!adapter || typeof adapter.get !== "function" || typeof adapter.put !== "function") {
    throw new Error("A Titan storage adapter is required");
  }

  const descriptor = Object.freeze({
    protocol: STORAGE_PROTOCOL,
    version: STORAGE_VERSION,
    company_boundary: "company_id",
    identity_grants_authority: false,
    execution_authority: false,
    device_first: true,
  });

  const normalizeLocator = (company_id: string, module: unknown, collection: unknown, record: unknown) => {
    const module_id = cleanPart(module, "module_id", true);
    const collection_id = cleanPart(collection, "collection", true);
    const record_id = cleanPart(record, "record_id");
    return {
      module_id,
      collection: collection_id,
      record_id,
      pk: makePk(company_id, module_id, collection_id, record_id),
    };
  };

  return Object.freeze({
    descriptor,

    async put(
      contextInput: StorageContextInput,
      input: Readonly<{
        module_id: string;
        collection: string;
        record_id: string;
        expected_revision?: number;
        data?: unknown;
      }>,
    ): Promise<StorageRecord> {
      const context = normalizeStorageContext(contextInput);
      assertNoLegacyStorageBoundary(input, "record");
      assertCompanyConsistency(input, context.company_id, "record");
      const locator = normalizeLocator(context.company_id, input.module_id, input.collection, input.record_id);

      if (context.idempotency_key && adapter.getIdempotency) {
        const priorPk = await adapter.getIdempotency(idempotencyPk(context.company_id, context.idempotency_key));
        if (priorPk) {
          const prior = await adapter.get(priorPk);
          if (prior) return prior;
        }
      }

      const prior = await adapter.get(locator.pk);
      const actualRevision = prior?.version ?? 0;
      if (input.expected_revision != null && input.expected_revision !== actualRevision) {
        throw new Error(
          `Revision conflict for ${locator.record_id}: expected ${input.expected_revision}, actual ${actualRevision}`,
        );
      }
      const now = Number(clock());
      const next: StorageRecord = Object.freeze({
        pk: locator.pk,
        company_id: context.company_id,
        module_id: locator.module_id,
        collection: locator.collection,
        record_id: locator.record_id,
        version: actualRevision + 1,
        created_at: prior?.created_at ?? now,
        updated_at: now,
        deleted: false,
        data: structuredClone(input.data ?? null),
        actor_id: context.actor_id,
        operation_id: context.operation_id,
      });
      await adapter.put(next);
      if (context.idempotency_key && adapter.putIdempotency) {
        await adapter.putIdempotency(idempotencyPk(context.company_id, context.idempotency_key), next.pk);
      }
      return next;
    },

    async get(
      contextInput: StorageContextInput,
      module_id: string,
      collection: string,
      record_id: string,
    ): Promise<StorageRecord | null> {
      const context = normalizeStorageContext(contextInput);
      const locator = normalizeLocator(context.company_id, module_id, collection, record_id);
      const record = await adapter.get(locator.pk);
      if (!record || record.deleted || record.company_id !== context.company_id) return null;
      return record;
    },

    async list(
      contextInput: StorageContextInput,
      query: Readonly<{ module_id?: string; collection?: string }> = {},
    ): Promise<readonly StorageRecord[]> {
      const context = normalizeStorageContext(contextInput);
      const module_id = query.module_id == null ? null : cleanPart(query.module_id, "module_id", true);
      const collection = query.collection == null ? null : cleanPart(query.collection, "collection", true);
      if (collection && !module_id) throw new Error("module_id is required when collection is provided");
      const rows = await adapter.listByCompany(context.company_id);
      return rows
        .filter((record) =>
          record.company_id === context.company_id &&
          !record.deleted &&
          (module_id == null || record.module_id === module_id) &&
          (collection == null || record.collection === collection),
        )
        .sort((a, b) => a.pk.localeCompare(b.pk));
    },

    async transaction<T>(
      contextInput: StorageContextInput,
      work: (repository: ReturnType<typeof createCompanyRepository>, context: ReturnType<typeof normalizeStorageContext>) => Promise<T>,
    ): Promise<T> {
      const context = normalizeStorageContext(contextInput);
      if (typeof adapter.transaction !== "function") {
        throw new Error("Storage adapter does not provide transactional workflow support");
      }
      if (typeof work !== "function") throw new Error("Transaction work function is required");
      return adapter.transaction(async (txAdapter) => {
        const txRepository = createCompanyRepository({ adapter: txAdapter, clock });
        return work(txRepository, context);
      });
    },

    async delete(
      contextInput: StorageContextInput,
      module_id: string,
      collection: string,
      record_id: string,
      options: Readonly<{ expected_revision?: number }> = {},
    ): Promise<StorageRecord> {
      const context = normalizeStorageContext(contextInput);
      const locator = normalizeLocator(context.company_id, module_id, collection, record_id);
      const prior = await adapter.get(locator.pk);
      const actualRevision = prior?.version ?? 0;
      if (options.expected_revision != null && options.expected_revision !== actualRevision) {
        throw new Error(
          `Revision conflict for ${locator.record_id}: expected ${options.expected_revision}, actual ${actualRevision}`,
        );
      }
      const now = Number(clock());
      const tombstone: StorageRecord = Object.freeze({
        pk: locator.pk,
        company_id: context.company_id,
        module_id: locator.module_id,
        collection: locator.collection,
        record_id: locator.record_id,
        version: actualRevision + 1,
        created_at: prior?.created_at ?? now,
        updated_at: now,
        deleted: true,
        data: null,
        actor_id: context.actor_id,
        operation_id: context.operation_id,
      });
      await adapter.put(tombstone);
      return tombstone;
    },
  });
}
