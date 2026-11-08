export const RETRIEVER_DONOR_REFERENCE_POLICY = Object.freeze({
  schema: "titan-zero-retriever-donor-reference-policy/v1",
  company_boundary: "company_id",
  live_donor_execution_allowed: false,
  ported_provenance_retained: true,
  migration_provenance_retained: true,
  native_runtime_may_reference_donor: false,
  donor_file_removal_requires_pass9_gate: true,
  identity_grants_authority: false,
});

export type RetrieverDonorReferenceClass =
  | "native"
  | "ported-provenance"
  | "migration-provenance"
  | "other";

export function classifyRetrieverDonorReference(path: string): RetrieverDonorReferenceClass {
  const normalized = String(path ?? "").replaceAll("\\", "/");
  if (normalized.startsWith("packages/titan-platform/src/retriever/")) return "native";
  if (normalized.startsWith("packages/titan-platform/src/ported/")) return "ported-provenance";
  if (normalized.startsWith("packages/titan-zero-migration-source/")) return "migration-provenance";
  return "other";
}
