// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/rollback-target-drift.mjs
const clean=v=>String(v??'').trim();
export function evaluateRollbackTargetDrift({company_id,operation_id,expected_current_hash,live_current_hash,rollback_target_hash}={}){
 const c=clean(company_id); if(!c) throw new Error('company_id-required');
 const expected=clean(expected_current_hash), live=clean(live_current_hash), target=clean(rollback_target_hash);
 const drift=!expected||!live||expected!==live;
 return Object.freeze({schema:'titan.reliability.rollback-target-drift.v1',company_id:c,company_boundary:'company_id',operation_id:clean(operation_id)||null,rollback_target_hash:target||null,drift_detected:drift,safe_to_rollback:!drift&&!!target,auto_rollback:false,requires_explicit_reconciliation:drift,advisory_only:true,grants_authority:false});
}
