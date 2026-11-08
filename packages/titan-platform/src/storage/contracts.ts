import { createCompanyExecutionContext } from "../runtime.js";

export const STORAGE_PROTOCOL = "titan.storage.native";
export const STORAGE_VERSION = "1.0";

export type StorageContextInput = Readonly<{
  company_id?: string;
  tenant_id?: string;
  tenant_company_id?: string;
  actor_id?: string | null;
  operation_id?: string | null;
  idempotency_key?: string | null;
}>;

export type CompanyStorageContext = Readonly<{
  company_id: string;
  actor_id: string | null;
  operation_id: string | null;
  idempotency_key: string | null;
}>;

export type StorageRecord<T = unknown> = Readonly<{
  pk: string;
  company_id: string;
  module_id: string;
  collection: string;
  record_id: string;
  version: number;
  created_at: number;
  updated_at: number;
  deleted: boolean;
  data: T;
  actor_id: string | null;
  operation_id: string | null;
}>;

export interface StorageAdapter {
  get(key: string): Promise<StorageRecord | null>;
  put(record: StorageRecord): Promise<void>;
  delete?(key: string): Promise<void>;
  listByCompany(company_id: string): Promise<readonly StorageRecord[]>;
  getIdempotency?(key: string): Promise<string | null>;
  putIdempotency?(key: string, recordPk: string): Promise<void>;
  transaction?<T>(work: (adapter: StorageAdapter) => Promise<T>): Promise<T>;
}

const FORBIDDEN = new Set(["tenant_id", "tenant_company_id", "workspace_tenant_id"]);

export function assertNoLegacyStorageBoundary(value: unknown, path = "value"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoLegacyStorageBoundary(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN.has(key)) {
      throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is the only company boundary`);
    }
    assertNoLegacyStorageBoundary(child, `${path}.${key}`);
  }
}

export function normalizeStorageContext(input: StorageContextInput): CompanyStorageContext {
  assertNoLegacyStorageBoundary(input, "context");
  const runtime = createCompanyExecutionContext(input, { allowLegacyAliases: false });
  const idempotency_key =
    typeof input.idempotency_key === "string" && input.idempotency_key.trim()
      ? input.idempotency_key.trim()
      : null;
  return Object.freeze({
    company_id: runtime.company_id,
    actor_id: runtime.actor_id,
    operation_id: runtime.operation_id,
    idempotency_key,
  });
}
