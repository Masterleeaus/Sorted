// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/deadline-budget.mjs
const clean=v=>String(v??'').trim();
const freeze=v=>Object.freeze(v);
export function createDeadlineBudget({company_id,operation_id,deadline_at,now=Date.now(),max_attempt_ms=1000}={}){
  const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
  const deadline=Number(deadline_at); if(!Number.isFinite(deadline)) throw new Error('deadline_at-required');
  return freeze({schema:'titan.reliability.deadline-budget.v1',company_id:companyId,company_boundary:'company_id',operation_id:clean(operation_id)||null,created_at:Number(now),deadline_at:deadline,max_attempt_ms:Math.max(1,Number(max_attempt_ms)||1000),authority_neutral:true,grants_authority:false,changes_permissions:false,changes_autonomy:false,authority_effect:false});
}
export function evaluateDeadline(budget,{company_id,now=Date.now()}={}){
  if(!budget||budget.schema!=='titan.reliability.deadline-budget.v1') throw new TypeError('deadline-budget-required');
  const id=clean(company_id); if(id&&id!==budget.company_id) throw new Error('cross-company:deadline-budget');
  const remaining=Math.max(0,budget.deadline_at-Number(now));
  const allowed=remaining>0;
  return freeze({schema:'titan.reliability.deadline-evaluation.v1',company_id:budget.company_id,operation_id:budget.operation_id,allowed,reason:allowed?'deadline_available':'deadline_expired',remaining_ms:remaining,attempt_timeout_ms:allowed?Math.min(remaining,budget.max_attempt_ms):0,advisory_only:true,executable_actions:freeze([]),authority_neutral:true,grants_authority:false,changes_permissions:false,changes_autonomy:false,authority_effect:false});
}
