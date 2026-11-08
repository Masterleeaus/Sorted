// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/recovery-intent-effect-match.mjs
const clean = value => String(value ?? '').trim();
const freeze = Object.freeze;
const normalizeIds = value => Array.isArray(value)
  ? [...new Set(value.map(clean).filter(Boolean))].sort()
  : null;

export function evaluateRecoveryIntentEffectMatch({
  company_id,
  evidence_company_id = null,
  recovery_id = null,
  approved_effect_ids = null,
  proposed_effect_ids = null,
} = {}) {
  const companyId = clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const evidenceCompany = clean(evidence_company_id);
  if (evidenceCompany && evidenceCompany !== companyId) throw new Error('cross-company:recovery-intent-effect-match');

  const approved = normalizeIds(approved_effect_ids);
  const proposed = normalizeIds(proposed_effect_ids);
  const verifiable = approved !== null && proposed !== null;
  const approvedSet = new Set(approved || []);
  const unapproved = verifiable ? proposed.filter(id => !approvedSet.has(id)) : [];
  const mismatch = verifiable && unapproved.length > 0;
  const safe = verifiable && !mismatch;

  return freeze({
    schema: 'titan.reliability.recovery-intent-effect-match.v1',
    company_id: companyId,
    recovery_id: clean(recovery_id) || null,
    verifiable,
    mismatch_detected: mismatch,
    approved_effect_ids: freeze(approved || []),
    proposed_effect_ids: freeze(proposed || []),
    unapproved_effect_ids: freeze(unapproved),
    safe_to_execute: safe,
    reason: safe ? null : (!verifiable ? 'recovery_intent_effects_unverifiable' : 'recovery_effect_outside_approved_intent'),
    auto_expand_intent: false,
    auto_execute: false,
    advisory_only: true,
    authority_effect: false,
    grants_authority: false,
    changes_permissions: false,
    changes_autonomy: false,
  });
}
