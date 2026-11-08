// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/recovery-plan-replay-guard.mjs
const clean=v=>String(v??'').trim();
export function evaluateRecoveryPlanReplay({company_id,plan_id,execution_token,consumed_tokens=[]}={}){
 const c=clean(company_id); if(!c) throw new Error('company_id-required');
 const token=clean(execution_token); const consumed=new Set((Array.isArray(consumed_tokens)?consumed_tokens:[]).map(clean));
 const replay=!!token&&consumed.has(token);
 return Object.freeze({schema:'titan.reliability.recovery-plan-replay-guard.v1',company_id:c,company_boundary:'company_id',plan_id:clean(plan_id)||null,replay_detected:replay,allowed:!!token&&!replay,auto_execute:false,requires_explicit_execution:true,advisory_only:true,grants_authority:false});
}
