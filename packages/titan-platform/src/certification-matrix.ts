import type { CompatibilityManifest, ProjectionCell } from './compatibility-pipeline.js';

/** v1 callers remain source-compatible, but results alone no longer prove coverage. */
export type CertificationCell = {
  cell_id: string;
  mandatory: boolean;
  status: 'PASS' | 'FAIL' | 'SKIPPED' | 'NOT_RUN' | 'NOT_APPLICABLE';
  provenance_ref: string | null;
  command?: string;
  coverage_ref?: 'declared-inputs';
};

/** A read-only projection of #7 registry output and #718 declared release scope.
 * The trusted caller must load these independently of submitted test results.
 * This contract neither discovers production scope nor authenticates receipts.
 */
export type CertificationInputs = {
  schema: 'titan.certification-inputs/v1';
  policy: 'cross-host-required/v1';
  candidate_revision: string;
  artifact_hash: string;
  registry_revision: string;
  scope_revision: string;
  registry: { version: string; entries: readonly { registry_id: string }[] };
  compatibility: CompatibilityManifest;
  projections: readonly ProjectionCell[];
};
export type CertificationEvidence = {
  schema: 'titan.certification-results/v1';
  coverage_key: string;
  cells: readonly CertificationCell[];
};
export type ExpectedCertificationCell = { cell_id: string; mandatory: true; check: string; projection: ProjectionCell };
export type CertificationCoverage = {
  coverage_key: string | null;
  expected_cells: readonly ExpectedCertificationCell[];
  denial_reasons: readonly string[];
};
export type ReleaseEligibility = {
  schema: 'titan.release-eligibility/v1';
  eligible: boolean;
  failed_cells: readonly string[];
  missing_provenance_cells: readonly string[];
  cells: readonly CertificationCell[];
  evidence_policy: 'cross-host-required/v1';
  coverage_key: string | null;
  expected_cells: readonly ExpectedCertificationCell[];
  missing_result_cells: readonly string[];
  denial_reasons: readonly string[];
  authorityGranted: false;
  publication_state: 'NOT_EVALUATED';
};

// Certification dimensions inherited from #717, not a product/host catalogue.
// v1 deliberately has no NA/empty-scope exemptions: unsupported combinations deny.
const CHECKS = [
  'discovery-schema', 'isolation-authority', 'governed-operations', 'workforce',
  'ui-fallback', 'vertical-projection', 'continuity-recovery',
  'compatibility-propagation', 'distribution-conformance',
] as const;
const PROJECTION_KEYS = ['foundation_product', 'vertical_profile', 'entitlement_profile', 'platform_adapter', 'contract_version'] as const;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const revision = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(value);
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Re-derived on every evaluation; never accept a result-supplied expected-cell list. */
export function deriveCertificationCoverage(raw: unknown): CertificationCoverage {
  const errors = new Set<string>();
  const deny = (reason: string) => errors.add(reason);
  if (!isRecord(raw)) return { coverage_key: null, expected_cells: [], denial_reasons: ['expected-coverage-required'] };
  if (raw.schema !== 'titan.certification-inputs/v1') deny('inputs-schema-unsupported');
  if (raw.policy !== 'cross-host-required/v1') deny('coverage-policy-unsupported');
  for (const key of ['candidate_revision', 'registry_revision', 'scope_revision']) if (!revision(raw[key])) deny(`${key}-invalid`);
  if (typeof raw.artifact_hash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(raw.artifact_hash)) deny('artifact-hash-invalid');

  const registry = isRecord(raw.registry) ? raw.registry : {};
  if (!isText(registry.version)) deny('registry-version-invalid');
  const entries = Array.isArray(registry.entries) ? registry.entries : [];
  if (!entries.length) deny('registry-coverage-empty');
  const registryIds = new Set<string>();
  for (const entry of entries) {
    if (!isRecord(entry) || !isText(entry.registry_id)) { deny('registry-identity-invalid'); continue; }
    if (registryIds.has(entry.registry_id)) deny(`registry-identity-duplicate:${entry.registry_id}`);
    registryIds.add(entry.registry_id);
  }

  const compatibility = isRecord(raw.compatibility) ? raw.compatibility : {};
  if (compatibility.schema !== 'titan.compatibility-manifest.v1') deny('compatibility-schema-unsupported');
  for (const key of ['core_version', 'registry_version', 'contract_version']) if (!isText(compatibility[key])) deny(`compatibility-${key}-invalid`);
  if (compatibility.registry_version !== registry.version) deny('compatibility-registry-version-mismatch');
  if (compatibility.source_revision !== raw.candidate_revision) deny('compatibility-candidate-mismatch');
  if (!isText(compatibility.generated_at) || !Number.isFinite(Date.parse(compatibility.generated_at))) deny('compatibility-generated-at-invalid');

  const projections = Array.isArray(raw.projections) ? raw.projections : [];
  if (!projections.length) deny('projection-coverage-empty');
  const projectionByKey = new Map<string, ProjectionCell>();
  for (const value of projections) {
    if (!isRecord(value) || !PROJECTION_KEYS.every(key => isText(value[key]))) { deny('projection-identity-invalid'); continue; }
    const projection = Object.fromEntries(PROJECTION_KEYS.map(key => [key, value[key]])) as ProjectionCell;
    const key = JSON.stringify(PROJECTION_KEYS.map(name => projection[name]));
    if (projectionByKey.has(key)) deny(`projection-identity-duplicate:${key}`);
    if (projection.contract_version !== compatibility.contract_version) deny(`projection-contract-mismatch:${key}`);
    projectionByKey.set(key, projection);
  }
  const canonicalProjections = [...projectionByKey.entries()].sort(([a], [b]) => compare(a, b));
  const expected_cells = canonicalProjections.flatMap(([key, projection]) => CHECKS.map(check => ({
    cell_id: `${encodeURIComponent(key)}:${check}`, mandatory: true as const, check, projection: { ...projection },
  }))).sort((a, b) => compare(a.cell_id, b.cell_id));
  // A canonical serialized binding, NOT a signature, digest, approval or receipt.
  // Bind actual registry membership and projection tuples as well as revision labels.
  const coverage_key = errors.size ? null : JSON.stringify({
    schema: raw.schema, policy: raw.policy, candidate_revision: raw.candidate_revision,
    artifact_hash: raw.artifact_hash, registry_revision: raw.registry_revision, scope_revision: raw.scope_revision,
    registry_version: registry.version, registry_ids: sorted(registryIds),
    compatibility: { schema: compatibility.schema, core_version: compatibility.core_version,
      registry_version: compatibility.registry_version, contract_version: compatibility.contract_version,
      source_revision: compatibility.source_revision, generated_at: compatibility.generated_at },
    projections: canonicalProjections.map(([, projection]) => projection),
  });
  return { coverage_key, expected_cells, denial_reasons: sorted(errors) };
}

/** Evidence evaluation only. Eligibility does not publish or grant authority.
 * Untrusted JSON is checked at runtime even when a TypeScript caller casts it.
 */
export function evaluateReleaseEligibility(evidence: readonly CertificationCell[] | CertificationEvidence, inputs?: CertificationInputs): ReleaseEligibility {
  const coverage = deriveCertificationCoverage(inputs);
  const denial = new Set(coverage.denial_reasons);
  const failed = new Set<string>();
  const missingProvenance = new Set<string>();
  const missingResults = new Set<string>();
  const expected = new Map(coverage.expected_cells.map(cell => [cell.cell_id, cell]));
  const seen = new Set<string>();
  const accepted: CertificationCell[] = [];
  const envelope: Record<string, unknown> = isRecord(evidence) ? evidence : {};
  const cells: unknown = Array.isArray(evidence) ? evidence : envelope.cells;
  if (envelope.schema !== 'titan.certification-results/v1') denial.add('results-envelope-required');
  if (coverage.coverage_key === null || envelope.coverage_key !== coverage.coverage_key) denial.add('coverage-binding-mismatch');
  if (!Array.isArray(cells)) denial.add('results-array-required');
  const results: unknown[] = Array.isArray(cells) ? cells : [];
  if (!results.length) denial.add('results-empty');
  for (const value of results) {
    if (!isRecord(value) || !isText(value.cell_id)) { denial.add('result-identity-invalid'); continue; }
    const id = value.cell_id;
    if (seen.has(id)) denial.add(`duplicate-result:${id}`);
    seen.add(id);
    const required = expected.has(id);
    const advisory = id.startsWith('advisory:') && id.length > 'advisory:'.length && value.mandatory === false;
    if (!required && !advisory) denial.add(`unexpected-result:${id}`);
    if (typeof value.mandatory !== 'boolean' || (required && value.mandatory !== true)) denial.add(`required-flag-invalid:${id}`);
    const validStatus = typeof value.status === 'string' && ['PASS', 'FAIL', 'SKIPPED', 'NOT_RUN', 'NOT_APPLICABLE'].includes(value.status);
    if (!validStatus) denial.add(`status-invalid:${id}`);
    if (value.status === 'NOT_APPLICABLE') denial.add(`applicability-unsupported:${id}`);
    if ((required || value.mandatory === true) && value.status !== 'PASS') {
      failed.add(id);
      denial.add(`required-not-pass:${id}`);
    }
    if (!isText(value.provenance_ref)) {
      missingProvenance.add(id);
      denial.add(`provenance-required:${id}`);
    }
    if (!isText(value.command)) denial.add(`command-required:${id}`);
    if (value.coverage_ref !== 'declared-inputs') denial.add(`coverage-reference-invalid:${id}`);
    // Retain only structurally valid typed cells; malformed inputs still produce denials.
    if (typeof value.mandatory === 'boolean' && validStatus && (value.provenance_ref === null || typeof value.provenance_ref === 'string')) {
      accepted.push({cell_id:id, mandatory:value.mandatory, status:value.status as CertificationCell['status'], provenance_ref:value.provenance_ref,
        ...(typeof value.command === 'string' ? {command:value.command} : {}),
        ...(value.coverage_ref === 'declared-inputs' ? {coverage_ref:'declared-inputs' as const} : {})});
    }
  }
  for (const id of expected.keys()) if (!seen.has(id)) { missingResults.add(id); denial.add(`missing-result:${id}`); }
  accepted.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  return {
    schema:'titan.release-eligibility/v1', eligible:denial.size === 0,
    failed_cells:sorted(failed), missing_provenance_cells:sorted(missingProvenance), cells:accepted,
    evidence_policy:'cross-host-required/v1', coverage_key:coverage.coverage_key,
    expected_cells:coverage.expected_cells, missing_result_cells:sorted(missingResults), denial_reasons:sorted(denial),
    authorityGranted:false, publication_state:'NOT_EVALUATED',
  };
}
