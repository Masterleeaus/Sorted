// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/recovery-approval-freshness.mjs
const clean = value => String(value ?? '').trim();
const freeze = Object.freeze;

export function evaluateRecoveryApprovalFreshness({
  company_id,
  evidence_company_id = null,
  approval_id = null,
  approved_at_ms = null,
  execution_at_ms = Date.now(),
  max_age_ms = 30000,
} = {}) {
  const companyId = clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const evidenceCompany = clean(evidence_company_id);
  if (evidenceCompany && evidenceCompany !== companyId) throw new Error('cross-company:recovery-approval-freshness');

  const approvedAt = Number(approved_at_ms);
  const executionAt = Number(execution_at_ms);
  const maxAge = Number(max_age_ms);
  const verifiable = Number.isFinite(approvedAt) && Number.isFinite(executionAt) && Number.isFinite(maxAge) && maxAge >= 0;
  const futureApproval = verifiable && approvedAt > executionAt;
  const ageMs = verifiable ? Math.max(0, executionAt - approvedAt) : null;
  const stale = verifiable && !futureApproval && ageMs > maxAge;
  const safe = verifiable && !futureApproval && !stale;

  return freeze({
    schema: 'titan.reliability.recovery-approval-freshness.v1',
    company_id: companyId,
    approval_id: clean(approval_id) || null,
    verifiable,
    stale,
    future_approval_timestamp: futureApproval,
    age_ms: ageMs,
    max_age_ms: verifiable ? maxAge : null,
    safe_to_execute: safe,
    reason: safe ? null : (!verifiable ? 'recovery_approval_freshness_unverifiable' : futureApproval ? 'recovery_approval_timestamp_in_future' : 'recovery_approval_expired'),
    auto_renew: false,
    auto_execute: false,
    advisory_only: true,
    authority_effect: false,
    grants_authority: false,
    changes_permissions: false,
    changes_autonomy: false,
  });
}
