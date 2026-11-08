// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/monotonic-recovery-checkpoint.mjs
const clean=v=>String(v??'').trim();
export function evaluateRecoveryCheckpoint({company_id,operation_id,previous_sequence=0,next_sequence=0,previous_checkpoint_id=null,next_checkpoint_id=null}={}){
 const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
 const operationId=clean(operation_id); if(!operationId) throw new Error('operation_id-required');
 const previous=Math.max(0,Number(previous_sequence)||0), next=Math.max(0,Number(next_sequence)||0);
 const regression=next<previous;
 return Object.freeze({company_id:companyId,operation_id:operationId,previous_sequence:previous,next_sequence:next,previous_checkpoint_id:clean(previous_checkpoint_id)||null,next_checkpoint_id:clean(next_checkpoint_id)||null,regression_detected:regression,safe_to_commit:!regression,reason:regression?'checkpoint_regression':null,rewrites_checkpoint:false,auto_commit:false,authority_effect:false,grants_authority:false});
}
