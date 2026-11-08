import { createHash } from "node:crypto";

export type DistributionProfile =
  | "BROWSER_EXTENSION"
  | "CMS_WEB"
  | "DEVELOPER_SDK"
  | "AUTOMATION"
  | "ACCOUNTING_DISTRIBUTION"
  | "AI_HOST"
  | "GENERIC_EMBED"
  | "MARKETPLACE_PACKAGE";

export type DistributionState =
  | "BUILT"
  | "VERIFIED"
  | "READY_TO_SUBMIT"
  | "SUBMITTED"
  | "REVIEWING"
  | "PUBLISHED"
  | "REJECTED"
  | "SUPERSEDED"
  | "RETIRED"
  | "REVOKED";

export type DistributionManifest = Readonly<{
  schema: "titan.distribution-manifest.v1";
  manifest_id: string;
  company_id: string;
  product_ref: string;
  vertical_ref: string;
  tier_ref: string;
  platform: DistributionProfile;
  capability_ids: readonly string[];
  contract_versions: readonly string[];
  artifact_hash: string;
  provenance_ref: string;
  state: DistributionState;
  authorityGranted: false;
}>;

const profiles = new Set<DistributionProfile>([
  "BROWSER_EXTENSION",
  "CMS_WEB",
  "DEVELOPER_SDK",
  "AUTOMATION",
  "ACCOUNTING_DISTRIBUTION",
  "AI_HOST",
  "GENERIC_EMBED",
  "MARKETPLACE_PACKAGE",
]);

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name}-required`);
  return normalized;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueReferences(values: readonly string[], name: string): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${name}-required`);
  const normalized = values.map((value) => required(value, name));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${name}-duplicate`);
  return Object.freeze([...normalized].sort(compareText));
}

export function createDistributionManifest(
  input: Omit<DistributionManifest, "state" | "authorityGranted">,
): DistributionManifest {
  const manifest_id = required(input.manifest_id, "manifest_id");
  const company_id = required(input.company_id, "company_id");
  const product_ref = required(input.product_ref, "product_ref");
  const vertical_ref = required(input.vertical_ref, "vertical_ref");
  const tier_ref = required(input.tier_ref, "tier_ref");
  const artifact_hash = required(input.artifact_hash, "artifact_hash");
  const provenance_ref = required(input.provenance_ref, "provenance_ref");

  if (!profiles.has(input.platform)) throw new Error("distribution-profile-invalid");
  if (!/^sha256:[a-f0-9]{64}$/i.test(artifact_hash)) throw new Error("artifact-hash-invalid");

  return Object.freeze({
    schema: "titan.distribution-manifest.v1" as const,
    manifest_id,
    company_id,
    product_ref,
    vertical_ref,
    tier_ref,
    platform: input.platform,
    capability_ids: uniqueReferences(input.capability_ids, "capability-id"),
    contract_versions: uniqueReferences(input.contract_versions, "contract-version"),
    artifact_hash,
    provenance_ref,
    state: "BUILT" as const,
    authorityGranted: false as const,
  });
}

export function transitionDistribution(
  manifest: DistributionManifest,
  state: DistributionState,
): DistributionManifest {
  const allowed: Record<DistributionState, DistributionState[]> = {
    BUILT: ["VERIFIED", "REJECTED"],
    VERIFIED: ["READY_TO_SUBMIT", "REJECTED"],
    READY_TO_SUBMIT: ["SUBMITTED"],
    SUBMITTED: ["REVIEWING", "REJECTED"],
    REVIEWING: ["PUBLISHED", "REJECTED"],
    PUBLISHED: ["SUPERSEDED", "RETIRED", "REVOKED"],
    REJECTED: ["BUILT"],
    SUPERSEDED: ["RETIRED", "REVOKED"],
    RETIRED: [],
    REVOKED: [],
  };
  if (!allowed[manifest.state].includes(state)) throw new Error("distribution-transition-invalid");
  return Object.freeze({ ...manifest, state });
}

export function verifyDistributionArtifact(
  manifest: DistributionManifest,
  artifactBytes: Uint8Array,
): DistributionManifest {
  if (!(artifactBytes instanceof Uint8Array)) throw new Error("artifact-bytes-invalid");
  if (artifactBytes.byteLength === 0) throw new Error("artifact-bytes-empty");

  const actualHash = "sha256:" + createHash("sha256").update(artifactBytes).digest("hex");
  if (actualHash !== manifest.artifact_hash.toLowerCase()) {
    throw new Error("artifact-hash-mismatch");
  }

  return transitionDistribution(manifest, "VERIFIED");
}

export function projectMatrix(
  base: Omit<DistributionManifest, "manifest_id" | "platform" | "state" | "authorityGranted">,
  profilesToBuild: readonly DistributionProfile[],
): readonly DistributionManifest[] {
  if (!Array.isArray(profilesToBuild) || profilesToBuild.length === 0) {
    throw new Error("distribution-profile-required");
  }
  if (new Set(profilesToBuild).size !== profilesToBuild.length) {
    throw new Error("distribution-profile-duplicate");
  }

  return Object.freeze(
    profilesToBuild
      .map((platform) =>
        createDistributionManifest({
          ...base,
          manifest_id: `${base.product_ref}:${base.vertical_ref}:${base.tier_ref}:${platform.toLowerCase()}`,
          platform,
        }),
      )
      .sort((left, right) => compareText(left.manifest_id, right.manifest_id)),
  );
}
