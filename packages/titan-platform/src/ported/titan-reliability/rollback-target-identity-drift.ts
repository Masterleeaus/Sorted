// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/rollback-target-identity-drift.mjs
const clean = v => String(v ?? '').trim();
const freeze = Object.freeze;
function assertCompany(expected, actual, source) {
  const id = clean(actual); if (id && expected && id !== expected) throw new Error(`cross-company:${source}`);
}
function identity(target) { return `${clean(target?.type)}:${clean(target?.id)}`; }
export function inspectRollbackTargetIdentityDrift({ company_id, rollback_id, approved_target = null, execution_target = null } = {}) {
  const companyId = clean(company_id); if (!companyId) throw new Error('company_id-required');
  assertCompany(companyId, approved_target?.company_id, 'approved-target');
  assertCompany(companyId, execution_target?.company_id, 'execution-target');
  const approvedType = clean(approved_target?.type); const approvedId = clean(approved_target?.id);
  const executionType = clean(execution_target?.type); const executionId = clean(execution_target?.id);
  const malformed = !approvedType || !approvedId || !executionType || !executionId;
  const drift = !malformed && identity(approved_target) !== identity(execution_target);
  return freeze({
    schema:'titan.reliability.rollback-target-identity-drift.v1', company_id:companyId, rollback_id:clean(rollback_id)||null,
    approved_target_identity: malformed && (!approvedType || !approvedId) ? null : identity(approved_target),
    execution_target_identity: malformed && (!executionType || !executionId) ? null : identity(execution_target),
    target_identity_drift_detected: malformed || drift, safe_to_rollback:!(malformed || drift),
    reason: malformed ? 'rollback_target_identity_missing' : drift ? 'rollback_target_identity_drift' : null,
    advisory_only:true, grants_authority:false, changes_permissions:false, changes_autonomy:false, authority_effect:false,
  });
}
