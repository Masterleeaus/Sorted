import type { DistributionProfile } from "./distribution-gateway.js";

export type CoverageDisposition = "PLANNED" | "BLOCKED";
export type SourceOwner = 1042 | 719 | 1068;

export type CanonicalInputSlot = Readonly<{
  slot: number;
  label: string | null;
  owner_issue: SourceOwner;
  canonical_ref: null;
  input_revision: null;
  disposition: "REFERENCE_PENDING" | "VALIDATION_PENDING" | "IDENTITY_PENDING";
}>;

export type DistributionFamily = Readonly<{
  family_id: string;
  label: string;
  conformance_profile: DistributionProfile;
  adapter_ids: readonly string[];
}>;

const productLabels = [
  "AI-assisted invoicing",
  "AI-assisted bookings",
  "AI-assisted quoting",
  "AI-assisted scheduling & dispatch",
  "AI-assisted job management",
] as const;

const verticalLabels: readonly (string | null)[] = [
  "Cleaning",
  "Plumbing",
  "Electrical",
  "HVAC",
  "Handyman & Property Maintenance",
  "Landscaping / Gardening / Lawn Care",
  "Pest Control",
  "Locksmith & Security",
  "Roofing & Guttering",
  "Appliance & Equipment Repair",
  null, null, null, null, null, null, null, null, null, null,
];

export const FOUNDATION_PRODUCT_SLOTS: readonly CanonicalInputSlot[] = Object.freeze(
  productLabels.map((label, index) => Object.freeze({
    slot: index + 1,
    label,
    owner_issue: 1042 as const,
    canonical_ref: null,
    input_revision: null,
    disposition: "REFERENCE_PENDING" as const,
  })),
);

export const FOUNDATION_TIER_SLOTS: readonly CanonicalInputSlot[] = Object.freeze([
  { slot: 1, label: "Free / Assist", owner_issue: 1042 as const, canonical_ref: null, input_revision: null, disposition: "REFERENCE_PENDING" as const },
  { slot: 2, label: "Plus / Semi-autonomous", owner_issue: 1042 as const, canonical_ref: null, input_revision: null, disposition: "REFERENCE_PENDING" as const },
  { slot: 3, label: "Pro / Autonomous + predictive", owner_issue: 1042 as const, canonical_ref: null, input_revision: null, disposition: "REFERENCE_PENDING" as const },
].map((slot) => Object.freeze(slot)));

export const VERTICAL_PROFILE_SLOTS: readonly CanonicalInputSlot[] = Object.freeze(
  verticalLabels.map((label, index) => Object.freeze({
    slot: index + 1,
    label,
    owner_issue: 719 as const,
    canonical_ref: null,
    input_revision: null,
    disposition: label ? "VALIDATION_PENDING" as const : "IDENTITY_PENDING" as const,
  })),
);

const distributionFamilies: DistributionFamily[] = [
  { family_id: "browser-chrome", label: "Google Chrome Web Store", conformance_profile: "BROWSER_EXTENSION", adapter_ids: ["chrome-web-store"] },
  { family_id: "browser-edge", label: "Microsoft Edge Add-ons", conformance_profile: "BROWSER_EXTENSION", adapter_ids: ["edge-add-ons"] },
  { family_id: "browser-firefox", label: "Mozilla Firefox Add-ons", conformance_profile: "BROWSER_EXTENSION", adapter_ids: ["firefox-add-ons"] },
  { family_id: "browser-safari", label: "Safari Extensions", conformance_profile: "BROWSER_EXTENSION", adapter_ids: ["safari-extensions"] },
  { family_id: "cms-wordpress", label: "WordPress", conformance_profile: "CMS_WEB", adapter_ids: ["wordpress"] },
  { family_id: "cms-woocommerce", label: "WooCommerce", conformance_profile: "CMS_WEB", adapter_ids: ["woocommerce"] },
  { family_id: "cms-shopify", label: "Shopify", conformance_profile: "CMS_WEB", adapter_ids: ["shopify"] },
  { family_id: "cms-webflow", label: "Webflow", conformance_profile: "CMS_WEB", adapter_ids: ["webflow"] },
  { family_id: "cms-wix", label: "Wix", conformance_profile: "CMS_WEB", adapter_ids: ["wix"] },
  { family_id: "cms-squarespace", label: "Squarespace", conformance_profile: "CMS_WEB", adapter_ids: ["squarespace"] },
  { family_id: "developer-npm", label: "npm", conformance_profile: "DEVELOPER_SDK", adapter_ids: ["npm"] },
  { family_id: "developer-composer", label: "Composer / Packagist", conformance_profile: "DEVELOPER_SDK", adapter_ids: ["composer-packagist"] },
  { family_id: "developer-pypi", label: "PyPI", conformance_profile: "DEVELOPER_SDK", adapter_ids: ["pypi"] },
  { family_id: "developer-github-releases", label: "GitHub Releases", conformance_profile: "MARKETPLACE_PACKAGE", adapter_ids: ["github-releases"] },
  { family_id: "automation-zapier", label: "Zapier", conformance_profile: "AUTOMATION", adapter_ids: ["zapier"] },
  { family_id: "automation-make", label: "Make", conformance_profile: "AUTOMATION", adapter_ids: ["make"] },
  { family_id: "automation-n8n", label: "n8n", conformance_profile: "AUTOMATION", adapter_ids: ["n8n"] },
  { family_id: "accounting-xero", label: "Xero", conformance_profile: "ACCOUNTING_DISTRIBUTION", adapter_ids: ["xero"] },
  { family_id: "accounting-quickbooks", label: "QuickBooks Online", conformance_profile: "ACCOUNTING_DISTRIBUTION", adapter_ids: ["quickbooks-online"] },
  { family_id: "ai-host-distribution", label: "AI-host distribution", conformance_profile: "AI_HOST", adapter_ids: ["chatgpt", "claude"] },
];
export const DISTRIBUTION_FAMILIES: readonly DistributionFamily[] = Object.freeze(
  distributionFamilies.map((family) => Object.freeze({ ...family, adapter_ids: Object.freeze([...family.adapter_ids]) })),
);

export type ConfigurationCoverageRow = Readonly<{
  configuration_id: string;
  product_slot: number;
  vertical_slot: number;
  tier_slot: number;
  product_ref: null;
  vertical_ref: null;
  tier_ref: null;
  input_revisions: null;
  disposition: CoverageDisposition;
  gap_owner: 1042 | 719;
  reason: string;
}>;

export type AdapterProjectionCoverageRow = Readonly<{
  projection_id: string;
  configuration_id: string;
  family_id: string;
  adapter_id: string;
  conformance_profile: DistributionProfile;
  adapter_revision: null;
  disposition: CoverageDisposition;
  gap_owner: 1068;
  reason: string;
}>;

export type DistributionCoverageSnapshot = Readonly<{
  source_issue_body_hashes: readonly Readonly<{ issue: SourceOwner; sha256: string }>[];
  schema: "titan.distribution-coverage/v1";
  source_owners: readonly SourceOwner[];
  foundation_configurations: readonly ConfigurationCoverageRow[];
  adapter_projections: readonly AdapterProjectionCoverageRow[];
}>;

function requireUnique(values: readonly string[], label: string): void {
  if (values.some((value) => !value.trim()) || new Set(values).size !== values.length) {
    throw new Error(`${label}-identity-invalid-or-duplicate`);
  }
}

export function buildDistributionCoverageSnapshot(): DistributionCoverageSnapshot {
  const products = FOUNDATION_PRODUCT_SLOTS;
  const verticals = VERTICAL_PROFILE_SLOTS;
  const tiers = FOUNDATION_TIER_SLOTS;
  const families = DISTRIBUTION_FAMILIES;
  const familyIds = families.map((family) => family.family_id);
  const adapterIds = families.flatMap((family) => family.adapter_ids);

  if (products.length !== 5 || verticals.length !== 20 || tiers.length !== 3 || families.length !== 20 || adapterIds.length !== 21) {
    throw new Error("distribution-launch-matrix-cardinality-invalid");
  }
  requireUnique(familyIds, "distribution-family");
  requireUnique(adapterIds, "distribution-adapter");

  const foundationConfigurations = products.flatMap((product) =>
    verticals.flatMap((vertical) =>
      tiers.map((tier) => Object.freeze({
        configuration_id: `p${product.slot}-v${vertical.slot}-t${tier.slot}`,
        product_slot: product.slot,
        vertical_slot: vertical.slot,
        tier_slot: tier.slot,
        product_ref: product.canonical_ref,
        vertical_ref: vertical.canonical_ref,
        tier_ref: tier.canonical_ref,
        input_revisions: null,
        disposition: "BLOCKED" as const,
        gap_owner: vertical.disposition === "IDENTITY_PENDING" ? 719 as const : 1042 as const,
        reason: vertical.disposition === "IDENTITY_PENDING"
          ? "vertical_identity_and_revision_pending_from_canonical_owner"
          : "canonical_product_vertical_and_tier_references_or_revisions_not_verified",
      })),
    ),
  );

  const configurationsById = new Map(foundationConfigurations.map((row) => [row.configuration_id, row]));
  const adapterProjections = foundationConfigurations.flatMap((configuration) =>
    families.flatMap((family) =>
      family.adapter_ids.map((adapterId) => Object.freeze({
        projection_id: `${configuration.configuration_id}-${adapterId}`,
        configuration_id: configuration.configuration_id,
        family_id: family.family_id,
        adapter_id: adapterId,
        conformance_profile: family.conformance_profile,
        adapter_revision: null,
        disposition: "BLOCKED" as const,
        gap_owner: 1068 as const,
        reason: "adapter_implementation_revision_and_conformance_evidence_pending",
      })),
    ),
  );

  if (configurationsById.size !== 300 || adapterProjections.length !== 6300) {
    throw new Error("distribution-coverage-output-cardinality-invalid");
  }
  requireUnique(foundationConfigurations.map((row) => row.configuration_id), "distribution-configuration");
  requireUnique(adapterProjections.map((row) => row.projection_id), "distribution-projection");

  return Object.freeze({
    source_issue_body_hashes: Object.freeze([
      Object.freeze({ issue: 719 as const, sha256: "65aa851baa2a8f3e247641c8787da0f1d4520831e4c3124282ef013e1482d97c" }),
      Object.freeze({ issue: 1042 as const, sha256: "763bdcf31676d2a657c25847676a4a74931432346c62afbcd3ec189cf962a1b9" }),
      Object.freeze({ issue: 1068 as const, sha256: "da5b8a5a674a8463251beb2eff9154f1e6d0c8b49671ad12e7a3b38a013e513f" }),
    ]),
    schema: "titan.distribution-coverage/v1",
    source_owners: Object.freeze([1042, 719, 1068] as const),
    foundation_configurations: Object.freeze(foundationConfigurations),
    adapter_projections: Object.freeze(adapterProjections),
  });
}
