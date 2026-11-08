import type { StorageContextInput, StorageRecord } from "./contracts.js";

type MigrationRepository = Readonly<{
  put(context: StorageContextInput, input: Readonly<{
    module_id: string;
    collection: string;
    record_id: string;
    expected_revision?: number;
    data?: unknown;
  }>): Promise<StorageRecord>;
  get(context: StorageContextInput, module_id: string, collection: string, record_id: string): Promise<StorageRecord | null>;
  list(context: StorageContextInput, query?: Readonly<{ module_id?: string; collection?: string }>): Promise<readonly StorageRecord[]>;
  delete(context: StorageContextInput, module_id: string, collection: string, record_id: string, options?: Readonly<{ expected_revision?: number }>): Promise<StorageRecord>;
  transaction<T>(
    context: StorageContextInput,
    work: (repository: MigrationRepository, context: StorageContextInput) => Promise<T>,
  ): Promise<T>;
}>;

export type MigrationDefinition = Readonly<{
  id: string;
  version: number;
  checksum: string;
  up: (context: Readonly<{ company_id: string; migration_id: string; version: number }>) => unknown | Promise<unknown>;
  down?: (context: Readonly<{ company_id: string; migration_id: string; version: number }>) => unknown | Promise<unknown>;
}>;

const MODULE_ID = "titan.storage";
const CHECKPOINTS = "migration-checkpoints";
const ROLLBACK_RECEIPTS = "migration-rollbacks";
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/;

function normalizeMigration(migration: MigrationDefinition): MigrationDefinition {
  if (!migration || typeof migration !== "object") throw new Error("Migration definition is required");
  const id = String(migration.id ?? "").trim().toLowerCase();
  if (!SAFE_ID.test(id)) throw new Error("Migration id must be 1-256 safe characters");
  const version = Number(migration.version);
  if (!Number.isInteger(version) || version < 1) throw new Error(`Migration ${id} version must be a positive integer`);
  const checksum = String(migration.checksum ?? "").trim();
  if (!checksum) throw new Error(`Migration ${id} checksum is required`);
  if (typeof migration.up !== "function") throw new Error(`Migration ${id} up contract is required`);
  return Object.freeze({ ...migration, id, version, checksum });
}

function contextCompanyId(input: StorageContextInput): string {
  const company_id = String(input?.company_id ?? "").trim();
  if (!company_id) throw new Error("company_id is required for migration coordination");
  if ("tenant_id" in (input ?? {}) || "tenant_company_id" in (input ?? {})) {
    throw new Error("Legacy tenant boundary rejected; company_id is the only company boundary");
  }
  return company_id;
}

export function createMigrationCoordinator({
  repository,
  clock = () => Date.now(),
}: {
  repository: MigrationRepository;
  clock?: () => number;
}) {
  if (
    !repository ||
    typeof repository.get !== "function" ||
    typeof repository.put !== "function" ||
    typeof repository.transaction !== "function"
  ) {
    throw new Error("Transaction-capable canonical Titan storage repository is required");
  }

  const descriptor = Object.freeze({
    protocol: "titan.storage.migrations.v1" as const,
    company_boundary: "company_id" as const,
    checkpoint_after_success_only: true,
    retry_failed_stages: true,
    skip_completed_stages: true,
    identity_grants_authority: false,
    execution_authority: false,
  });

  async function getCheckpoint(
    context: StorageContextInput,
    migrationId: string,
    source: MigrationRepository = repository,
  ) {
    const id = String(migrationId ?? "").trim().toLowerCase();
    const stored = await source.get(context, MODULE_ID, CHECKPOINTS, id);
    return stored?.data ? structuredClone(stored.data as object) as any : null;
  }

  return Object.freeze({
    descriptor,

    getCheckpoint,

    async run(context: StorageContextInput, rawMigration: MigrationDefinition) {
      const migration = normalizeMigration(rawMigration);
      const company_id = contextCompanyId(context);

      return repository.transaction(
        { ...context, company_id, idempotency_key: null },
        async (tx, txContext) => {
          const storageContext = Object.freeze({ ...txContext, company_id, idempotency_key: null });
          const existing = await getCheckpoint(storageContext, migration.id, tx);

          if (existing) {
            if (existing.version !== migration.version || existing.checksum !== migration.checksum) {
              throw new Error(
                `Migration compatibility conflict for ${migration.id}: checkpoint v${existing.version}/${existing.checksum} does not match v${migration.version}/${migration.checksum}`,
              );
            }
            return Object.freeze({
              status: "skipped" as const,
              company_id,
              migration_id: migration.id,
              version: migration.version,
              checkpoint: existing,
            });
          }

          const started_at = Number(clock());
          const result = await migration.up(Object.freeze({
            company_id,
            migration_id: migration.id,
            version: migration.version,
          }));
          const completed_at = Number(clock());

          const checkpoint = Object.freeze({
            schema: "titan.storage.migration-checkpoint.v1",
            company_id,
            migration_id: migration.id,
            version: migration.version,
            checksum: migration.checksum,
            status: "completed" as const,
            started_at,
            completed_at,
            result: structuredClone(result ?? null),
          });

          await tx.put(
            storageContext,
            {
              module_id: MODULE_ID,
              collection: CHECKPOINTS,
              record_id: migration.id,
              data: checkpoint,
            },
          );

          return Object.freeze({
            status: "applied" as const,
            company_id,
            migration_id: migration.id,
            version: migration.version,
            checkpoint,
          });
        },
      );
    },

    async rollback(
      context: StorageContextInput,
      rawMigration: MigrationDefinition,
      options: Readonly<{ reason?: string }> = {},
    ) {
      const migration = normalizeMigration(rawMigration);
      const company_id = contextCompanyId(context);
      if (typeof migration.down !== "function") {
        throw new Error(`Migration ${migration.id} has no rollback contract`);
      }
      const rollbackMigration = migration.down;

      return repository.transaction(
        { ...context, company_id, idempotency_key: null },
        async (tx, txContext) => {
          const storageContext = Object.freeze({ ...txContext, company_id, idempotency_key: null });
          const existing = await getCheckpoint(storageContext, migration.id, tx);
          if (!existing) throw new Error(`Migration ${migration.id} is not applied for company ${company_id}`);
          if (existing.version !== migration.version || existing.checksum !== migration.checksum) {
            throw new Error(`Migration compatibility conflict for rollback: ${migration.id}`);
          }

          const started_at = Number(clock());
          const result = await rollbackMigration(Object.freeze({
            company_id,
            migration_id: migration.id,
            version: migration.version,
          }));
          const completed_at = Number(clock());

          await tx.delete(storageContext, MODULE_ID, CHECKPOINTS, migration.id);

          const receipt = Object.freeze({
            schema: "titan.storage.migration-rollback-receipt.v1",
            company_id,
            migration_id: migration.id,
            version: migration.version,
            checksum: migration.checksum,
            status: "rolled_back" as const,
            reason: String(options.reason ?? "").trim() || null,
            started_at,
            completed_at,
            result: structuredClone(result ?? null),
          });
          const receiptId = `${migration.id}:${completed_at}`;
          await tx.put(storageContext, {
            module_id: MODULE_ID,
            collection: ROLLBACK_RECEIPTS,
            record_id: receiptId,
            data: receipt,
          });

          return receipt;
        },
      );
    },

    async listRollbackReceipts(context: StorageContextInput) {
      const company_id = contextCompanyId(context);
      const rows = await repository.list(context, { module_id: MODULE_ID, collection: ROLLBACK_RECEIPTS });
      return rows
        .map((row) => row.data as any)
        .filter((receipt) => receipt?.company_id === company_id)
        .map((receipt) => structuredClone(receipt));
    },
  });
}
