import {evaluateJobTransition} from './jobs-lifecycle-contract.mjs';
const clean=v=>typeof v==='string'?v.trim():'';
const LEGACY=['tenant_id','tenantId','tenant_company_id'];
function requireContext(input){for(const k of LEGACY)if(input?.[k]!=null)throw new Error(`jobs-adapter-legacy-tenant-forbidden:${k}`);const company_id=clean(input?.company_id);const job_id=clean(input?.job_id);const operation_id=clean(input?.operation_id);if(!company_id)throw new Error('jobs-adapter-company-id-required');if(!job_id)throw new Error('jobs-adapter-job-id-required');if(!operation_id)throw new Error('jobs-adapter-operation-id-required');return {company_id,job_id,operation_id};}
function capabilityFor(to){return to==='completed'?'crm.work_order.complete':'crm.work_order.update';}
export function buildWorkOrderTransitionCommand(input={}){
 const ctx=requireContext(input);const decision=evaluateJobTransition({...input,...ctx});
 if(!decision.allowed)return {schema:'titan.zero.jobs.work-order-command.v2',...ctx,status:'DENIED',reason:decision.reason,capability:null,execution_permitted:false,authority_granted:false,proposal_only:true};
 const capability=capabilityFor(decision.to_state);const idempotency_key=`jobs:${ctx.company_id}:${ctx.job_id}:${ctx.operation_id}`;
 return {schema:'titan.zero.jobs.work-order-command.v2',...ctx,status:'READY_FOR_COMMAND_BUS',capability,canonical_owner:'Titan Field',payload:{company_id:ctx.company_id,job_id:ctx.job_id,from_state:decision.from_state,to_state:decision.to_state,transition_reason:clean(input.transition_reason)||null,completed_at:input.completed_at??null,checklist_complete:input.checklist_complete??null,evidence_attachment_ids:Array.isArray(input.evidence_attachment_ids)?[...input.evidence_attachment_ids]:[]},idempotency_key,authority_context:{authority_verified:true,source:'external-policy-gate'},execution_permitted:false,authority_granted:false,proposal_only:true,requires_command_bus:true,requires_execution_receipt:true,requires_post_verification:true,requires_existing_work_order:true,creates_parallel_record:false};
}
export function applyWorkOrderTransitionResult(command={},result={}){
 if(command.status!=='READY_FOR_COMMAND_BUS')throw new Error('jobs-adapter-command-not-ready-for-command-bus');
 if(result.company_id&&result.company_id!==command.company_id)throw new Error('jobs-adapter-cross-company-result');
 const base={schema:'titan.zero.jobs.transition-result.v2',company_id:command.company_id,job_id:command.job_id,operation_id:command.operation_id,idempotency_key:command.idempotency_key,capability:command.capability,provider_ref:clean(result.provider_ref)||null,receipt_id:clean(result.receipt_id)||null,authority_granted:false};
 if(result.ok!==true)return {...base,status:'FAILED',error_code:clean(result.error_code)||'WORK_ORDER_UPDATE_FAILED',post_verification_passed:false};
 if(result.command_bus_dispatched!==true)return {...base,status:'UNVERIFIED',error_code:'COMMAND_BUS_DISPATCH_REQUIRED',post_verification_passed:false};
 if(!base.receipt_id)return {...base,status:'UNVERIFIED',error_code:'EXECUTION_RECEIPT_REQUIRED',post_verification_passed:false};
 if(result.post_verification_passed!==true)return {...base,status:'UNVERIFIED',error_code:'POST_VERIFICATION_REQUIRED',post_verification_passed:false};
 return {...base,status:'APPLIED',error_code:null,post_verification_passed:true};
}
