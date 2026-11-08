// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/recovery-attempt-budget.mjs
const clean=v=>String(v??'').trim();
const freeze=v=>Object.freeze(v);
export function evaluateRecoveryAttemptBudget({company_id,operation_id=null,attempts=0,max_attempts=3}={}){
  const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
  const used=Math.max(0,Math.floor(Number(attempts)||0));
  const max=Math.max(1,Math.floor(Number(max_attempts)||1));
  const remaining=Math.max(0,max-used); const allowed=used<max;
  return freeze({
    schema:'titan.reliability.recovery-attempt-budget.v1', company_id:companyId,
    operation_id:clean(operation_id)||null, attempts:used, max_attempts:max,
    remaining_attempts:remaining, allowed,
    reason:allowed?'recovery_attempt_available':'recovery_attempt_budget_exhausted',
    automatic_replay_permitted:false, grants_authority:false, authority_effect:false,
  });
}
