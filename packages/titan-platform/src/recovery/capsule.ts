export interface TitanCapsuleManifest {
  capsule_id: string;
  format_version: "1.0";
  company_id: string;
  created_at: string;
  evidence_cursor: string;
  schema_versions: Readonly<Record<string, string>>;
  constitution_versions: readonly string[];
  provider_bindings: readonly { provider: string; site_ref: string; credential_ref: string; backup_digest: string }[];
  encrypted_secret_refs: readonly string[];
  payload_digest: string;
  mode: "recovery" | "clone";
  clone_namespace?: string;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function capsuleDigest(payload: unknown): string {
  let hash = 2166136261;
  for (const char of stable(payload)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function validateCapsule(manifest: TitanCapsuleManifest, payload: unknown, supportedFormat: TitanCapsuleManifest["format_version"] = "1.0"): void {
  if (manifest.format_version !== supportedFormat) throw new Error("unsupported capsule format");
  if (!manifest.capsule_id || !manifest.company_id || !manifest.evidence_cursor) throw new Error("capsule identity/evidence cursor is required");
  if (manifest.mode === "clone" && !manifest.clone_namespace) throw new Error("clone capsules require an isolated namespace");
  if (manifest.provider_bindings.some((binding) => !binding.credential_ref || !binding.backup_digest)) throw new Error("provider restore references must be opaque and verified");
  if (capsuleDigest(payload) !== manifest.payload_digest) throw new Error("capsule payload integrity check failed");
}

