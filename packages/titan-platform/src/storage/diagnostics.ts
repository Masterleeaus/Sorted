import {
  STORAGE_PROTOCOL,
  STORAGE_VERSION,
  normalizeStorageContext,
  type StorageContextInput,
  type StorageRecord,
} from "./contracts.js";

type DiagnosticRepository = Readonly<{
  list(context: StorageContextInput, query?: Readonly<{ module_id?: string; collection?: string }>): Promise<readonly StorageRecord[]>;
  transaction<T>(
    context: StorageContextInput,
    work: (repository: DiagnosticRepository, context: ReturnType<typeof normalizeStorageContext>) => Promise<T>,
  ): Promise<T>;
}>;

export function createStorageAuthorityDiagnostics({
  repository,
}: {
  repository: DiagnosticRepository;
}) {
  if (!repository?.list || typeof repository.transaction !== "function") {
    throw new Error("Transaction-capable canonical Titan repository is required for diagnostics");
  }

  const descriptor = Object.freeze({
    protocol: "titan.observability.storage-authority.native.v1" as const,
    storage_protocol: STORAGE_PROTOCOL,
    storage_version: STORAGE_VERSION,
    company_boundary: "company_id" as const,
    readonly: true,
    identity_grants_authority: false,
    execution_authority: false,
  });

  return Object.freeze({
    descriptor,

    async inspect(contextInput: StorageContextInput) {
      const context = normalizeStorageContext(contextInput);
      const rows = await repository.list(context);
      const drift: Array<Readonly<{ code: string; record_id: string; details: string }>> = [];

      for (const row of rows) {
        if (row.company_id !== context.company_id) {
          drift.push({
            code: "CROSS_COMPANY_RECORD",
            record_id: row.record_id,
            details: `Observed ${row.company_id} while scoped to ${context.company_id}`,
          });
        }
        if (!Number.isInteger(row.version) || row.version < 1) {
          drift.push({
            code: "INVALID_VERSION",
            record_id: row.record_id,
            details: `Observed record version ${String(row.version)}`,
          });
        }
        if (!row.pk.startsWith(`${encodeURIComponent(context.company_id)}|`)) {
          drift.push({
            code: "PK_COMPANY_PREFIX_DRIFT",
            record_id: row.record_id,
            details: "Primary key is not company-prefixed",
          });
        }
      }

      let readonly_transaction_canary = "PASS";
      try {
        await repository.transaction(
          { ...context, idempotency_key: null },
          async (tx, txContext) => {
            await tx.list({ ...txContext, idempotency_key: null });
            return true;
          },
        );
      } catch {
        readonly_transaction_canary = "FAIL";
      }

      const modules = [...new Set(rows.map((row) => row.module_id))].sort();
      const collections = [...new Set(rows.map((row) => `${row.module_id}/${row.collection}`))].sort();

      return Object.freeze({
        schema: "titan.observability.storage-authority.native.v1",
        company_id: context.company_id,
        health: drift.length === 0 && readonly_transaction_canary === "PASS" ? "healthy" : "degraded",
        record_count: rows.length,
        modules,
        collections,
        drift,
        readonly_transaction_canary,
        capabilities: Object.freeze({
          records: true,
          transactions: true,
          migration_checkpoints: true,
          migration_rollbacks: true,
          reconciliation_conflicts: true,
          business_receipts: true,
          business_conflicts: true,
          backup_restore: true,
          attachments: false,
          idempotency_index: true,
        }),
        authority_neutral: true,
        grants_authority: false,
      });
    },
  });
}
