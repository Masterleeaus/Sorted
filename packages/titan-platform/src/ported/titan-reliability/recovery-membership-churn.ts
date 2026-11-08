// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/recovery-membership-churn.mjs
const clean = value => String(value ?? '').trim();
const freeze = Object.freeze;
const arr = value => Array.isArray(value) ? value : [];

function normalizeMembers(values) {
  const raw = arr(values).map(clean);
  const valid = raw.every(Boolean) && new Set(raw).size === raw.length;
  return { ids: [...new Set(raw.filter(Boolean))].sort(), valid };
}

export function evaluateRecoveryMembershipChurn({
  company_id,
  evidence_company_id = null,
  recovery_id = null,
  decision_member_ids = [],
  execution_member_ids = [],
} = {}) {
  const companyId = clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const evidenceCompany = clean(evidence_company_id);
  if (evidenceCompany && evidenceCompany !== companyId) throw new Error('cross-company:recovery-membership-churn');

  const before = normalizeMembers(decision_member_ids);
  const after = normalizeMembers(execution_member_ids);
  const identityValid = before.valid && after.valid && before.ids.length > 0 && after.ids.length > 0;
  const beforeSet = new Set(before.ids);
  const afterSet = new Set(after.ids);
  const added = after.ids.filter(id => !beforeSet.has(id));
  const removed = before.ids.filter(id => !afterSet.has(id));
  const churnDetected = identityValid ? (added.length > 0 || removed.length > 0) : false;
  const safe = identityValid && !churnDetected;

  return freeze({
    schema: 'titan.reliability.recovery-membership-churn.v1',
    company_id: companyId,
    recovery_id: clean(recovery_id) || null,
    identity_valid: identityValid,
    churn_detected: churnDetected,
    decision_member_ids: freeze(before.ids),
    execution_member_ids: freeze(after.ids),
    added_member_ids: freeze(added),
    removed_member_ids: freeze(removed),
    safe_to_execute: safe,
    reason: safe ? null : (!identityValid ? 'recovery_membership_identity_invalid' : 'recovery_membership_changed_after_decision'),
    auto_reconfigure: false,
    auto_elect: false,
    advisory_only: true,
    authority_effect: false,
    grants_authority: false,
    changes_permissions: false,
    changes_autonomy: false,
  });
}
