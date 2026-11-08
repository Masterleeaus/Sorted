import {
  assertNoLegacyStorageBoundary,
  normalizeStorageContext,
  type StorageContextInput,
  type StorageRecord,
} from "./contracts.js";

type Repository = Readonly<{
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
    work: (repository: Repository, context: ReturnType<typeof normalizeStorageContext>) => Promise<T>,
  ): Promise<T>;
}>;

export type CompanyBackupRecord = Readonly<{
  company_id: string;
  module_id: string;
  collection: string;
  record_id: string;
  data: unknown;
}>;

export type CompanyBackup = {
  schema: "titan.storage.company-backup.v1";
  company_id: string;
  exported_at: number;
  record_count: number;
  checksum_algorithm: "fnv1a32-stable-json";
  checksum: string;
  records: CompanyBackupRecord[];
  authority_neutral: true;
  grants_authority: false;
};

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

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function checksum(value: unknown): string {
  const input = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function backupPayload(company_id: string, records: readonly CompanyBackupRecord[]) {
  return {
    schema: "titan.storage.company-backup.v1",
    company_id,
    records: records.map((record) => ({
      company_id: record.company_id,
      module_id: record.module_id,
      collection: record.collection,
      record_id: record.record_id,
      data: stableValue(record.data),
    })),
  };
}

function projectRecord(record: StorageRecord): CompanyBackupRecord {
  return {
    company_id: record.company_id,
    module_id: record.module_id,
    collection: record.collection,
    record_id: record.record_id,
    data: structuredClone(record.data),
  };
}

function sortRecords(records: readonly CompanyBackupRecord[]): CompanyBackupRecord[] {
  return [...records]
    .map((record) => structuredClone(record))
    .sort((a, b) => {
      const left = `${a.module_id}\u0000${a.collection}\u0000${a.record_id}`;
      const right = `${b.module_id}\u0000${b.collection}\u0000${b.record_id}`;
      return left.localeCompare(right);
    });
}

function locatorKey(record: CompanyBackupRecord): string {
  return `${record.module_id}\u0000${record.collection}\u0000${record.record_id}`;
}

export function createBackupRecoveryService({
  repository,
  clock = () => Date.now(),
}: {
  repository: Repository;
  clock?: () => number;
}) {
  if (!repository?.list || !repository?.put || !repository?.delete || typeof repository.transaction !== "function") {
    throw new Error("Transaction-capable canonical Titan repository is required for backup/recovery");
  }

  const descriptor = Object.freeze({
    protocol: "titan.storage.backup-recovery.v1" as const,
    company_boundary: "company_id" as const,
    transaction_required: true,
    validation_before_write: true,
    checksum_required: true,
    identity_grants_authority: false,
    execution_authority: false,
  });

  function verifyBackup(backup: CompanyBackup, options: Readonly<{ company_id?: string }> = {}) {
    if (!backup || typeof backup !== "object") throw new Error("Backup package is required");
    assertNoLegacyStorageBoundary(backup, "backup");
    if (backup.schema !== "titan.storage.company-backup.v1") throw new Error("Unsupported backup schema");
    const company_id = String(backup.company_id ?? "").trim();
    if (!company_id) throw new Error("Backup company_id is required");
    const expectedCompany = String(options.company_id ?? "").trim();
    if (expectedCompany && expectedCompany !== company_id) {
      throw new Error(`Cross-company backup rejected: expected ${expectedCompany}, received ${company_id}`);
    }
    if (!Array.isArray(backup.records)) throw new Error("Backup records must be an array");
    if (backup.record_count !== backup.records.length) throw new Error("Backup record count mismatch");
    if (backup.checksum_algorithm !== "fnv1a32-stable-json") throw new Error("Unsupported backup checksum algorithm");

    const seen = new Set<string>();
    for (const [index, record] of backup.records.entries()) {
      if (!record || typeof record !== "object") throw new Error(`Backup record ${index} is invalid`);
      assertNoLegacyStorageBoundary(record, `backup.records[${index}]`);
      if (String(record.company_id ?? "").trim() !== company_id) {
        throw new Error(`Cross-company backup record rejected at index ${index}`);
      }
      for (const field of ["module_id", "collection", "record_id"] as const) {
        if (!String(record[field] ?? "").trim()) throw new Error(`Backup record ${index} ${field} is required`);
      }
      const key = locatorKey(record);
      if (seen.has(key)) throw new Error(`Duplicate backup record locator: ${key}`);
      seen.add(key);
    }

    const records = sortRecords(backup.records);
    const actual = checksum(backupPayload(company_id, records));
    if (actual !== backup.checksum) {
      throw new Error(`Backup checksum mismatch: expected ${backup.checksum}, actual ${actual}`);
    }
    return Object.freeze({ valid: true, company_id, record_count: records.length, checksum: actual });
  }

  async function exportCompany(contextInput: StorageContextInput): Promise<CompanyBackup> {
    const context = normalizeStorageContext(contextInput);
    const records = sortRecords((await repository.list(context)).map(projectRecord));
    const digest = checksum(backupPayload(context.company_id, records));
    return {
      schema: "titan.storage.company-backup.v1",
      company_id: context.company_id,
      exported_at: Number(clock()),
      record_count: records.length,
      checksum_algorithm: "fnv1a32-stable-json",
      checksum: digest,
      records,
      authority_neutral: true,
      grants_authority: false,
    };
  }

  async function restoreCompany(
    contextInput: StorageContextInput,
    backup: CompanyBackup,
    options: Readonly<{ mode?: "replace" | "merge"; dry_run?: boolean }> = {},
  ) {
    const context = normalizeStorageContext(contextInput);
    const validation = verifyBackup(backup, { company_id: context.company_id });
    const mode = options.mode ?? "replace";
    if (mode !== "replace" && mode !== "merge") throw new Error(`Unsupported restore mode: ${String(mode)}`);
    const current = await repository.list(context);
    const backupRecords = sortRecords(backup.records);

    const plan = Object.freeze({
      company_id: context.company_id,
      mode,
      current_records: current.length,
      backup_records: backupRecords.length,
      checksum: validation.checksum,
    });
    if (options.dry_run === true) return Object.freeze({ status: "dry_run" as const, ...plan });

    const result = await repository.transaction(
      { ...context, idempotency_key: null },
      async (tx, txContext) => {
        const storageContext = Object.freeze({ ...txContext, idempotency_key: null });
        const before = await tx.list(storageContext);
        if (mode === "replace") {
          for (const record of before) {
            await tx.delete(
              storageContext,
              record.module_id,
              record.collection,
              record.record_id,
              { expected_revision: record.version },
            );
          }
        }
        for (const record of backupRecords) {
          await tx.put(storageContext, {
            module_id: record.module_id,
            collection: record.collection,
            record_id: record.record_id,
            data: structuredClone(record.data),
          });
        }
        const after = await tx.list(storageContext);
        if (mode === "replace") {
          const restoredProjection = sortRecords(after.map(projectRecord));
          const restoredChecksum = checksum(backupPayload(txContext.company_id, restoredProjection));
          if (restoredChecksum !== backup.checksum || restoredProjection.length !== backup.record_count) {
            throw new Error(
              `Recovery verification failed before commit: expected ${backup.checksum}/${backup.record_count}, actual ${restoredChecksum}/${restoredProjection.length}`,
            );
          }
        }
        return { before_count: before.length, after_count: after.length };
      },
    );

    const recovered = await exportCompany(context);
    if (mode === "replace" && recovered.checksum !== backup.checksum) {
      throw new Error(`Recovery verification failed: expected ${backup.checksum}, actual ${recovered.checksum}`);
    }
    if (mode === "replace" && recovered.record_count !== backup.record_count) {
      throw new Error("Recovery verification failed: restored record count mismatch");
    }

    return Object.freeze({
      status: "restored" as const,
      ...plan,
      restored_records: backupRecords.length,
      result,
      verified_checksum: mode === "replace" ? recovered.checksum : null,
      authority_neutral: true,
      grants_authority: false,
    });
  }

  return Object.freeze({ descriptor, exportCompany, verifyBackup, restoreCompany });
}
