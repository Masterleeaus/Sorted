import { createMemoryStorageAdapter } from "./memory-adapter.js";
import type { StorageAdapter } from "./contracts.js";

export const STORAGE_BACKENDS = Object.freeze(["indexeddb", "memory", "mysql", "postgres"] as const);
export type StorageBackend = (typeof STORAGE_BACKENDS)[number];

export type StorageAdapterFactory = () => StorageAdapter | Promise<StorageAdapter>;
export type StorageAdapterFactories = Partial<Record<StorageBackend, StorageAdapterFactory>>;

export type StorageBackendInput = Readonly<{
  backend?: string | null;
  database_url?: string | null;
}>;

const SUPPORTED = new Set<string>(STORAGE_BACKENDS);

function normalizeBackend(value: unknown): StorageBackend | null {
  const out = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!out) return null;
  if (!SUPPORTED.has(out)) throw new Error(`Unsupported storage backend: ${out}`);
  return out as StorageBackend;
}

export function inferStorageBackend(input: StorageBackendInput = {}): StorageBackend {
  const explicit = normalizeBackend(input.backend);
  if (explicit) return explicit;

  const rawUrl = typeof input.database_url === "string" ? input.database_url.trim() : "";
  if (!rawUrl) throw new Error("Storage backend could not be determined");

  let protocol: string;
  try {
    protocol = new URL(rawUrl).protocol.toLowerCase();
  } catch {
    throw new Error("Storage backend could not be determined from invalid database URL");
  }

  if (protocol === "postgres:" || protocol === "postgresql:") return "postgres";
  if (protocol === "mysql:" || protocol === "mariadb:") return "mysql";
  throw new Error(`Unsupported database protocol: ${protocol}`);
}

export async function selectStorageAdapter(input: StorageBackendInput & {
  factories?: StorageAdapterFactories;
}): Promise<Readonly<{
  backend: StorageBackend;
  adapter: StorageAdapter;
  descriptor: Readonly<{
    protocol: "titan.storage.adapter-selection.v1";
    backend: StorageBackend;
    company_boundary: "company_id";
    authority_source: "external_policy_only";
    identity_grants_authority: false;
    execution_authority: false;
    fallback_performed: false;
  }>;
}>> {
  const backend = inferStorageBackend(input);
  const factories = input.factories ?? {};

  let factory: StorageAdapterFactory | undefined = factories[backend];
  if (backend === "memory" && !factory) {
    factory = () => createMemoryStorageAdapter();
  }

  if (!factory) {
    throw new Error(`No registered adapter factory for storage backend: ${backend}`);
  }

  const adapter = await factory();
  if (!adapter || typeof adapter.get !== "function" || typeof adapter.put !== "function" || typeof adapter.listByCompany !== "function") {
    throw new Error(`Storage adapter factory for ${backend} returned an invalid adapter`);
  }

  return Object.freeze({
    backend,
    adapter,
    descriptor: Object.freeze({
      protocol: "titan.storage.adapter-selection.v1",
      backend,
      company_boundary: "company_id",
      authority_source: "external_policy_only",
      identity_grants_authority: false,
      execution_authority: false,
      fallback_performed: false,
    }),
  });
}
