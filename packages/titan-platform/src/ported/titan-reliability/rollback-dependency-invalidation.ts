// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/rollback-dependency-invalidation.mjs
const clean = value => String(value ?? '').trim();
const freeze = Object.freeze;
const arr = value => Array.isArray(value) ? value : [];

export function evaluateRollbackDependencyInvalidation({
  company_id,
  rollback_id = null,
  dependencies = [],
} = {}) {
  const companyId = clean(company_id);
  if (!companyId) throw new Error('company_id-required');

  const advanced = [];
  const invalidEvidence = [];
  for (const dep of arr(dependencies)) {
    const depCompany = clean(dep?.company_id);
    if (depCompany && depCompany !== companyId) throw new Error('cross-company:rollback-dependency');
    const id = clean(dep?.dependency_id) || 'unknown';
    const recorded = Number(dep?.recorded_revision);
    const current = Number(dep?.current_revision);
    if (!Number.isFinite(recorded) || !Number.isFinite(current) || recorded < 0 || current < 0) {
      invalidEvidence.push(id);
      continue;
    }
    if (current > recorded) advanced.push(id);
  }

  advanced.sort();
  invalidEvidence.sort();
  const evidenceValid = invalidEvidence.length === 0;
  const invalidated = advanced.length > 0;
  const safe = evidenceValid && !invalidated;

  return freeze({
    schema: 'titan.reliability.rollback-dependency-invalidation.v1',
    company_id: companyId,
    rollback_id: clean(rollback_id) || null,
    evidence_valid: evidenceValid,
    invalidated,
    advanced_dependency_ids: freeze(advanced),
    invalid_evidence_dependency_ids: freeze(invalidEvidence),
    safe_to_rollback: safe,
    reason: safe ? null : (!evidenceValid ? 'rollback_dependency_evidence_invalid' : 'rollback_dependency_advanced'),
    auto_rollback: false,
    rewrites_dependencies: false,
    advisory_only: true,
    authority_effect: false,
    grants_authority: false,
    changes_permissions: false,
    changes_autonomy: false,
  });
}
