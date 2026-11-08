// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/recovery-fencing-token.mjs
const clean = value => String(value ?? '').trim();
const freeze = Object.freeze;

export function evaluateRecoveryFencingToken({
  company_id,
  evidence_company_id = null,
  recovery_id = null,
  expected_fencing_token = null,
  observed_fencing_token = null,
} = {}) {
  const companyId = clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const evidenceCompany = clean(evidence_company_id);
  if (evidenceCompany && evidenceCompany !== companyId) throw new Error('cross-company:recovery-fencing-token');
  const expected = clean(expected_fencing_token);
  const observed = clean(observed_fencing_token);
  const verifiable = Boolean(expected && observed);
  const valid = verifiable && expected === observed;
  return freeze({
    schema: 'titan.reliability.recovery-fencing-token.v1',
    company_id: companyId,
    recovery_id: clean(recovery_id) || null,
    valid,
    verifiable,
    safe_to_recover: valid,
    reason: valid ? null : (verifiable ? 'recovery_fencing_token_mismatch' : 'recovery_fencing_token_unverifiable'),
    rotates_token: false,
    assigns_owner: false,
    advisory_only: true,
    authority_effect: false,
    grants_authority: false,
    changes_permissions: false,
    changes_autonomy: false,
  });
}
