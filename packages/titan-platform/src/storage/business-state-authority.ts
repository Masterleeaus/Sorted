import {
  normalizeStorageContext,
  type StorageContextInput,
  type StorageRecord,
} from "./contracts.js";

type TxRepository = Readonly<{
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

type BusinessRepository = TxRepository & Readonly<{
  transaction<T>(
    context: StorageContextInput,
    work: (repository: TxRepository, context: ReturnType<typeof normalizeStorageContext>) => Promise<T>,
  ): Promise<T>;
}>;

const PROTOCOL = "titan.business.state.native.v1";
const MODULE_ID = "titan.business-state";
const RECEIPTS = "receipts";
const CONFLICTS = "conflicts";
const SUMMARY = "summary";
const SUMMARY_ID = "state";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, stableValue((value as Record<string, unknown>)[key])]),
    );
  }
  return value === undefined ? "__titan_undefined__" : value;
}

function fingerprint(value: unknown): string {
  const input = JSON.stringify(stableValue(value)) || "";
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  }
  return `${input.length}-${(hash >>> 0).toString(16)}`;
}

function cleanDomain(value: unknown): string {
  const out = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{0,127}$/.test(out)) throw new Error("business-state domain is invalid");
  return out;
}

function cleanEntityId(value: unknown): string {
  const out = String(value ?? "").trim();
  if (!out) throw new Error("entity_id is required");
  return out;
}

function receiptId(key: string): string {
  return `idem-${fingerprint(key)}`;
}

function conflictId(value: unknown): string {
  return `conflict-${fingerprint(value)}`;
}

function defaultSummary(company_id: string) {
  return {
    protocol: PROTOCOL,
    company_id,
    commit_count: 0,
    idempotent_count: 0,
    conflict_count: 0,
    last_receipt: null as unknown,
    last_conflict: null as unknown,
  };
}

export function createBusinessStateAuthority({
  repository,
  clock = () => Date.now(),
}: {
  repository: BusinessRepository;
  clock?: () => number;
}) {
  if (!repository?.get || !repository?.put || typeof repository.transaction !== "function") {
    throw new Error("Transaction-capable canonical Titan repository is required");
  }

  const descriptor = Object.freeze({
    protocol: PROTOCOL,
    company_boundary: "company_id" as const,
    transaction_required: true,
    monotonic_revisions: true,
    durable_receipts: true,
    durable_conflicts: true,
    identity_grants_authority: false,
    execution_authority: false,
  });

  async function readSummary(tx: TxRepository, context: StorageContextInput, company_id: string) {
    const row = await tx.get(context, MODULE_ID, SUMMARY, SUMMARY_ID);
    return row?.data
      ? { ...defaultSummary(company_id), ...(structuredClone(row.data) as object), company_id }
      : defaultSummary(company_id);
  }

  async function writeSummary(
    tx: TxRepository,
    context: StorageContextInput,
    company_id: string,
    summary: ReturnType<typeof defaultSummary>,
  ) {
    return tx.put(context, {
      module_id: MODULE_ID,
      collection: SUMMARY,
      record_id: SUMMARY_ID,
      data: { ...summary, protocol: PROTOCOL, company_id },
    });
  }

  return Object.freeze({
    descriptor,

    async commit(
      contextInput: StorageContextInput,
      domainInput: string,
      recordInput: Record<string, unknown>,
      options: Readonly<{
        entity_id?: string;
        idempotency_key?: string;
        expected_revision?: number;
        source?: string;
      }> = {},
    ) {
      const context = normalizeStorageContext(contextInput);
      const domain = cleanDomain(domainInput);
      const entity_id = cleanEntityId(options.entity_id ?? recordInput?.id);
      if (!recordInput || typeof recordInput !== "object" || Array.isArray(recordInput)) {
        throw new Error("Business-state record must be an object");
      }
      if (recordInput.company_id != null && String(recordInput.company_id).trim() !== context.company_id) {
        throw new Error("Cross-company business-state payload rejected");
      }
      const canonicalRecord = { ...structuredClone(recordInput), company_id: context.company_id };
      const record_fingerprint = fingerprint(canonicalRecord);
      const idempotency_key = String(
        options.idempotency_key ??
        context.idempotency_key ??
        `${domain}:${entity_id}:${record_fingerprint}`,
      ).trim();
      if (!idempotency_key) throw new Error("idempotency_key is required");
      const expected_revision =
        Number.isInteger(options.expected_revision) && Number(options.expected_revision) >= 0
          ? Number(options.expected_revision)
          : null;
      const now = Number(clock());

      return repository.transaction(context, async (tx, txContext) => {
        // Business-state idempotency is authoritative at this layer. Internal
        // entity/receipt/summary writes must not be collapsed by the generic
        // repository idempotency receipt using the caller's same key.
        const storageContext = Object.freeze({ ...txContext, idempotency_key: null });
        const priorReceiptRow = await tx.get(storageContext, MODULE_ID, RECEIPTS, receiptId(idempotency_key));
        const priorReceipt = priorReceiptRow?.data as any;
        const currentRow = await tx.get(storageContext, MODULE_ID, domain, entity_id);
        const currentEnvelope = currentRow?.data as any;
        const actual_revision = Number(currentEnvelope?.revision ?? 0);

        if (priorReceipt?.status === "committed") {
          if (
            priorReceipt.record_fingerprint === record_fingerprint &&
            priorReceipt.domain === domain &&
            priorReceipt.entity_id === entity_id
          ) {
            const summary = await readSummary(tx, storageContext, txContext.company_id);
            summary.idempotent_count += 1;
            const result = {
              ...structuredClone(priorReceipt),
              status: "idempotent",
              committed: false,
              idempotent: true,
              conflict: false,
              at: now,
            };
            summary.last_receipt = result;
            await writeSummary(tx, storageContext, txContext.company_id, summary);
            return result;
          }

          const conflict = {
            protocol: PROTOCOL,
            receipt_id: `business-conflict-${fingerprint({ idempotency_key, record_fingerprint, now })}`,
            status: "conflict",
            committed: false,
            idempotent: false,
            conflict: true,
            company_id: txContext.company_id,
            domain,
            entity_id,
            revision: actual_revision,
            expected_revision,
            actual_revision,
            idempotency_key,
            record_fingerprint,
            reason: "idempotency_key_reused",
            at: now,
          };
          await tx.put(storageContext, {
            module_id: MODULE_ID,
            collection: CONFLICTS,
            record_id: conflictId(conflict),
            data: conflict,
          });
          const summary = await readSummary(tx, storageContext, txContext.company_id);
          summary.conflict_count += 1;
          summary.last_conflict = conflict;
          summary.last_receipt = conflict;
          await writeSummary(tx, storageContext, txContext.company_id, summary);
          return conflict;
        }

        if (expected_revision !== null && expected_revision !== actual_revision) {
          const conflict = {
            protocol: PROTOCOL,
            receipt_id: `business-conflict-${fingerprint({ domain, entity_id, idempotency_key, expected_revision, actual_revision, now })}`,
            status: "conflict",
            committed: false,
            idempotent: false,
            conflict: true,
            company_id: txContext.company_id,
            domain,
            entity_id,
            revision: actual_revision,
            expected_revision,
            actual_revision,
            idempotency_key,
            record_fingerprint,
            reason: "revision_mismatch",
            at: now,
          };
          await tx.put(storageContext, {
            module_id: MODULE_ID,
            collection: CONFLICTS,
            record_id: conflictId(conflict),
            data: conflict,
          });
          const summary = await readSummary(tx, storageContext, txContext.company_id);
          summary.conflict_count += 1;
          summary.last_conflict = conflict;
          summary.last_receipt = conflict;
          await writeSummary(tx, storageContext, txContext.company_id, summary);
          return conflict;
        }

        const revision = actual_revision + 1;
        const envelope = {
          protocol: PROTOCOL,
          company_id: txContext.company_id,
          domain,
          entity_id,
          revision,
          previous_revision: actual_revision,
          idempotency_key,
          record_fingerprint,
          record: canonicalRecord,
          source: String(options.source ?? "titan-business-state-authority"),
          created_at: currentEnvelope?.created_at ?? now,
          updated_at: now,
        };

        await tx.put(storageContext, {
          module_id: MODULE_ID,
          collection: domain,
          record_id: entity_id,
          expected_revision: currentRow?.version ?? 0,
          data: envelope,
        });

        const receipt = {
          protocol: PROTOCOL,
          receipt_id: `business-receipt-${fingerprint({ domain, entity_id, idempotency_key, revision })}`,
          status: "committed",
          committed: true,
          idempotent: false,
          conflict: false,
          company_id: txContext.company_id,
          domain,
          entity_id,
          revision,
          previous_revision: actual_revision,
          expected_revision,
          actual_revision,
          idempotency_key,
          record_fingerprint,
          source: envelope.source,
          at: now,
        };

        await tx.put(storageContext, {
          module_id: MODULE_ID,
          collection: RECEIPTS,
          record_id: receiptId(idempotency_key),
          data: receipt,
        });

        const summary = await readSummary(tx, storageContext, txContext.company_id);
        summary.commit_count += 1;
        summary.last_receipt = receipt;
        await writeSummary(tx, storageContext, txContext.company_id, summary);

        return receipt;
      });
    },

    async read(context: StorageContextInput, domainInput: string, entityId: string) {
      const txContext = normalizeStorageContext(context);
      const domain = cleanDomain(domainInput);
      const entity_id = cleanEntityId(entityId);
      const row = await repository.get(txContext, MODULE_ID, domain, entity_id);
      return row?.data ? structuredClone(row.data) : null;
    },

    async listReceipts(context: StorageContextInput) {
      const txContext = normalizeStorageContext(context);
      const rows = await repository.list(txContext, { module_id: MODULE_ID, collection: RECEIPTS });
      return rows.map((row) => structuredClone(row.data));
    },

    async listConflicts(context: StorageContextInput) {
      const txContext = normalizeStorageContext(context);
      const rows = await repository.list(txContext, { module_id: MODULE_ID, collection: CONFLICTS });
      return rows.map((row) => structuredClone(row.data));
    },

    async snapshot(context: StorageContextInput) {
      const txContext = normalizeStorageContext(context);
      const row = await repository.get(txContext, MODULE_ID, SUMMARY, SUMMARY_ID);
      return row?.data
        ? structuredClone(row.data)
        : defaultSummary(txContext.company_id);
    },
  });
}
