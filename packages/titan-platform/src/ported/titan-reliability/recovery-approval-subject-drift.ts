// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/recovery-approval-subject-drift.mjs
const clean = v => String(v ?? '').trim();
const freeze = Object.freeze;
function assertCompany(expected, actual, source) {
  const id = clean(actual);
  if (id && expected && id !== expected) throw new Error(`cross-company:${source}`);
}
export function inspectRecoveryApprovalSubjectDrift({ company_id, approval = null, execution = null } = {}) {
  const companyId = clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  assertCompany(companyId, approval?.company_id, 'approval');
  assertCompany(companyId, execution?.company_id, 'execution');
  const approvedSubjectId = clean(approval?.subject_id);
  const executionSubjectId = clean(execution?.subject_id);
  const malformed = !approvedSubjectId || !executionSubjectId;
  const drift = !malformed && approvedSubjectId !== executionSubjectId;
  return freeze({
    schema:'titan.reliability.recovery-approval-subject-drift.v1',
    company_id:companyId,
    approval_id:clean(approval?.approval_id) || null,
    approved_subject_id:approvedSubjectId || null,
    execution_subject_id:executionSubjectId || null,
    subject_drift_detected: drift || malformed,
    safe_to_execute: !(drift || malformed),
    reason: malformed ? 'recovery_subject_missing' : drift ? 'recovery_approval_subject_drift' : null,
    advisory_only:true, grants_authority:false, changes_permissions:false, changes_autonomy:false, authority_effect:false,
  });
}
