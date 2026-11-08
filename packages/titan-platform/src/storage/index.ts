export {
  STORAGE_PROTOCOL,
  STORAGE_VERSION,
  assertNoLegacyStorageBoundary,
  normalizeStorageContext,
} from "./contracts.js";
export type {
  StorageAdapter,
  StorageContextInput,
  CompanyStorageContext,
  StorageRecord,
} from "./contracts.js";
export { createMemoryStorageAdapter } from "./memory-adapter.js";
export { createCompanyRepository } from "./repository.js";

export { STORAGE_BACKENDS, inferStorageBackend, selectStorageAdapter } from "./adapter-selection.js";
export type { StorageBackend, StorageAdapterFactory, StorageAdapterFactories, StorageBackendInput } from "./adapter-selection.js";

export { createMigrationCoordinator } from "./migrations.js";
export type { MigrationDefinition } from "./migrations.js";

export { createCompanyCheckpointFacade, createStorageReconciler } from "./reconciliation.js";

export { createBusinessStateAuthority } from "./business-state-authority.js";

export { createBackupRecoveryService } from "./backup-recovery.js";
export type { CompanyBackup, CompanyBackupRecord } from "./backup-recovery.js";

export { createStorageAuthorityDiagnostics } from "./diagnostics.js";

export { resolveCompanyBlobPlacement, assertBlobObjectBound, validateRestoreManifest } from "./blob-contract.js";
export type { BlobStorageRole, CompanyBlobPlacement, BlobObject, RestoreManifest } from "./blob-contract.js";
