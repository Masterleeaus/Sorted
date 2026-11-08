import {
  RETRIEVER_NATIVE_DEFAULT_CAPABILITIES,
  RETRIEVER_NATIVE_PROTOCOL,
  RETRIEVER_NATIVE_VERSION,
} from "./contracts.js";

export const RETRIEVER_SEMANTIC_RETIREMENT_SCHEMA =
  "titan-zero-retriever-semantic-retirement/v1";

const REQUIRED_LIFECYCLE = Object.freeze([
  "work_submission",
  "progress_observation",
  "result_delivery",
  "timeout",
  "cancellation",
] as const);

const REQUIRED_SURFACES = Object.freeze([
  "chat",
  "workflow",
  "side-panel-compatible",
] as const);

const REQUIRED_RECOVERY = Object.freeze([
  "checkpoint",
  "restore",
  "restart",
  "reconnect",
  "stale_session",
] as const);

type Evidence = Readonly<{
  native_protocol?: string;
  native_version?: string;
  native_capabilities?: readonly string[];
  lifecycle_paths?: readonly string[];
  surface_paths?: readonly string[];
  recovery_paths?: readonly string[];
  company_boundary?: string;
  identity_grants_authority?: boolean;
  live_donor_reference_count?: number;
  live_donor_import_count?: number;
  protected_hashes_present?: boolean;
  donor_hash_matches?: boolean;
  pass8_regressions_complete?: boolean;
  protected_hash_provenance?: Readonly<Record<string, unknown>> | null;
}>;

const hasAll = (actual: readonly string[] | undefined, required: readonly string[]) => {
  const values = new Set(actual ?? []);
  return required.every((item) => values.has(item));
};

export function evaluateRetrieverSemanticRetirement(evidence: Evidence = {}) {
  const blockers: string[] = [];

  if (evidence.native_protocol !== RETRIEVER_NATIVE_PROTOCOL) {
    blockers.push("NATIVE_PROTOCOL_MISMATCH");
  }
  if (evidence.native_version !== RETRIEVER_NATIVE_VERSION) {
    blockers.push("NATIVE_VERSION_MISMATCH");
  }
  if (!hasAll(evidence.native_capabilities, RETRIEVER_NATIVE_DEFAULT_CAPABILITIES)) {
    blockers.push("NATIVE_CAPABILITY_PARITY_INCOMPLETE");
  }
  if (!hasAll(evidence.lifecycle_paths, REQUIRED_LIFECYCLE)) {
    blockers.push("LIFECYCLE_PARITY_INCOMPLETE");
  }
  if (!hasAll(evidence.surface_paths, REQUIRED_SURFACES)) {
    blockers.push("SURFACE_PARITY_INCOMPLETE");
  }
  if (!hasAll(evidence.recovery_paths, REQUIRED_RECOVERY)) {
    blockers.push("RECOVERY_PARITY_INCOMPLETE");
  }
  if (evidence.company_boundary !== "company_id") {
    blockers.push("NONCANONICAL_COMPANY_BOUNDARY");
  }
  if (evidence.identity_grants_authority !== false) {
    blockers.push("IDENTITY_AUTHORITY_VIOLATION");
  }
  if ((evidence.live_donor_reference_count ?? 0) !== 0) {
    blockers.push("LIVE_DONOR_REFERENCES_REMAIN");
  }
  if ((evidence.live_donor_import_count ?? 0) !== 0) {
    blockers.push("LIVE_DONOR_IMPORTS_REMAIN");
  }

  const semanticContractsSatisfied = blockers.length === 0;
  const pass8Complete = evidence.pass8_regressions_complete === true;

  return Object.freeze({
    schema: RETRIEVER_SEMANTIC_RETIREMENT_SCHEMA,
    evidence_model: "semantic_contracts",
    protected_hash_policy: "PROVENANCE_ONLY_NOT_AUTHORIZATION",
    hash_match_required: false,
    donor_hash_matches: evidence.donor_hash_matches ?? null,
    protected_hashes_present: evidence.protected_hashes_present === true,
    semantic_contracts_satisfied: semanticContractsSatisfied,
    pass8_regressions_complete: pass8Complete,
    physical_removal_allowed: semanticContractsSatisfied && pass8Complete,
    blockers: Object.freeze(blockers),
    next_gate: !semanticContractsSatisfied
      ? "SEMANTIC_CONTRACT_REMEDIATION"
      : pass8Complete
        ? "PASS9_ZERO_REFERENCE_AND_ROLLBACK_GATE"
        : "PASS8_REGRESSION_CERTIFICATION",
    company_boundary: "company_id",
    identity_grants_authority: false,
    execution_authority: false,
  });
}

export function buildRetrieverSemanticRetirementLedger(evidence: Evidence = {}) {
  const evaluation = evaluateRetrieverSemanticRetirement(evidence);
  return Object.freeze({
    ...evaluation,
    protected_hash_provenance: Object.freeze({
      ...(evidence.protected_hash_provenance ?? {}),
    }),
    required_native_contracts: Object.freeze({
      protocol: RETRIEVER_NATIVE_PROTOCOL,
      version: RETRIEVER_NATIVE_VERSION,
      capabilities: RETRIEVER_NATIVE_DEFAULT_CAPABILITIES,
      lifecycle_paths: REQUIRED_LIFECYCLE,
      surface_paths: REQUIRED_SURFACES,
      recovery_paths: REQUIRED_RECOVERY,
      company_boundary: "company_id",
      identity_grants_authority: false,
    }),
    retirement_authority: "SEMANTIC_CONTRACTS_AND_REACHABILITY",
    byte_hash_authority: false,
    historical_hashes_preserved_for_provenance: true,
  });
}
