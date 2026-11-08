// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/recovery-decision-epoch.mjs
const clean = value => String(value ?? '').trim();
const freeze = Object.freeze;
const finiteInteger = value => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export function evaluateRecoveryDecisionEpoch({ company_id, decision_id = null, current_epoch = null, proposed_epoch = null } = {}) {
  const companyId = clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const current = finiteInteger(current_epoch);
  const proposed = finiteInteger(proposed_epoch);
  const verifiable = current !== null && proposed !== null;
  const regression = verifiable ? proposed < current : false;
  const safe = verifiable && !regression;
  return freeze({
    schema: 'titan.reliability.recovery-decision-epoch.v1',
    company_id: companyId,
    decision_id: clean(decision_id) || null,
    current_epoch: current,
    proposed_epoch: proposed,
    verifiable,
    regression_detected: regression,
    safe_to_consider: safe,
    reason: safe ? null : (regression ? 'recovery_decision_epoch_regression' : 'recovery_decision_epoch_unverifiable'),
    advances_epoch: false,
    advisory_only: true,
    authority_effect: false,
    grants_authority: false,
    changes_authority: false,
    changes_permissions: false,
    changes_autonomy: false,
  });
}
