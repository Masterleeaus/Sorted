const clean=(v,max=260)=>String(v??'').trim().slice(0,max);
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const isoOrNull=v=>{ const s=clean(v,80); return s||null; };
const RECOVERY_REASONS=new Set(['missed','voicemail','agent_unresolved','customer_requested_human','provider_failure','after_hours']);
const CUSTOMER_CHAIN={
 manager:'titan.manager.customer_service',
 supervisor:'titan.customer.customer_service_coordinator',
 customer_care:'titan.customer.customer_care_coordinator',
 reception:'titan.customer.receptionist',
 booking:'titan.customer.booking_coordinator'
};
function requireBase(input={}){
 const company_id=clean(input.company_id,128); if(!validCompany(company_id)) throw new Error('call-recovery-company_id-required');
 const call_ref=clean(input.call_ref,220); if(!call_ref) throw new Error('call-recovery-call_ref-required');
 const idempotency_key=clean(input.idempotency_key,220); if(!idempotency_key) throw new Error('call-recovery-idempotency-key-required');
 return {company_id,call_ref,idempotency_key};
}
export function detectCallRecoveryNeed(input={}){
 const b=requireBase(input); const state=clean(input.state,40).toLowerCase();
 const reason=clean(input.reason,60).toLowerCase(); const connected=Boolean(input.connected===true||state==='connected'||state==='transferred');
 const voicemail=Boolean(input.voicemail===true||state==='voicemail');
 const humanRequested=Boolean(input.human_requested===true||reason==='customer_requested_human');
 const unresolved=Boolean(input.agent_unresolved===true||reason==='agent_unresolved');
 const afterHours=Boolean(input.after_hours===true||reason==='after_hours');
 const missed=Boolean(input.missed===true||(!connected && ['ended','failed'].includes(state))||reason==='missed');
 let recovery_reason=null;
 if(humanRequested) recovery_reason='customer_requested_human'; else if(unresolved) recovery_reason='agent_unresolved'; else if(voicemail) recovery_reason='voicemail'; else if(afterHours&&missed) recovery_reason='after_hours'; else if(missed) recovery_reason=reason==='provider_failure'?'provider_failure':'missed';
 return {schema:'titan.workforce.call-recovery-detection.v1',...b,recovery_required:Boolean(recovery_reason),recovery_reason,
  grants_authority:false,authority_effect:false,execution_permitted:false};
}
export function buildCallEvidenceEnvelope(input={}){
 const b=requireBase(input); const transcript_ref=clean(input.transcript_ref,260)||null; const voicemail_ref=clean(input.voicemail_ref,260)||null;
 const recording_ref=clean(input.recording_ref,260)||null; const provider_receipt_ref=clean(input.provider_receipt_ref,260)||null;
 const summary_ref=clean(input.summary_ref,260)||null;
 if(![transcript_ref,voicemail_ref,recording_ref,provider_receipt_ref,summary_ref].some(Boolean)) throw new Error('call-recovery-evidence-reference-required');
 return {schema:'titan.workforce.call-evidence-envelope.v1',...b,evidence:{transcript_ref,voicemail_ref,recording_ref,provider_receipt_ref,summary_ref},
  data_policy:'REFERENCES_ONLY_NO_PROVIDER_SECRETS',immutable:true,grants_authority:false,authority_effect:false,execution_permitted:false};
}
export function planCallbackRecovery(input={}){
 const detection=detectCallRecoveryNeed(input); if(!detection.recovery_required) return {...detection,status:'NO_RECOVERY_REQUIRED',handoffs:[]};
 const callback_requested=Boolean(input.callback_requested!==false);
 const callback_window_ref=clean(input.callback_window_ref,220)||null;
 const customer_ref=clean(input.customer_ref,220)||null;
 const caller_ref=clean(input.caller_ref,220)||null;
 const handoffs=[];
 if(callback_requested){
  handoffs.push({type:'GOVERNED_HANDOFF',intent:'callback_schedule_proposal',orchestrator:'reception',manager:CUSTOMER_CHAIN.manager,supervisor:CUSTOMER_CHAIN.supervisor,
   specialist:CUSTOMER_CHAIN.booking,target_worker:'titan.worker.create_follow_up_agent',company_id:detection.company_id,call_ref:detection.call_ref,
   customer_ref,caller_ref,callback_window_ref,requires_approval:true,execution_permitted:false});
 }
 handoffs.push({type:'GOVERNED_HANDOFF',intent:'customer_care_review',orchestrator:'customer-care',manager:CUSTOMER_CHAIN.manager,supervisor:CUSTOMER_CHAIN.supervisor,
  specialist:CUSTOMER_CHAIN.customer_care,target_worker:'titan.worker.send_customer_message_agent',company_id:detection.company_id,call_ref:detection.call_ref,
  customer_ref,caller_ref,requires_approval:true,execution_permitted:false});
 return {schema:'titan.workforce.call-recovery-plan.v1',...detection,status:'RECOVERY_PLAN_PROPOSED',handoffs,grants_authority:false,authority_effect:false,execution_permitted:false};
}
export function planVoicemailHandoff(input={}){
 const b=requireBase(input); const voicemail_ref=clean(input.voicemail_ref,260); if(!voicemail_ref) throw new Error('call-recovery-voicemail-ref-required');
 return {schema:'titan.workforce.voicemail-customer-care-handoff.v1',...b,status:'PROPOSED',manager:CUSTOMER_CHAIN.manager,supervisor:CUSTOMER_CHAIN.supervisor,
  specialist:CUSTOMER_CHAIN.customer_care,orchestrator:'customer-care',intent:'review_voicemail_and_decide_response',voicemail_ref,
  transcript_ref:clean(input.transcript_ref,260)||null,customer_ref:clean(input.customer_ref,220)||null,caller_ref:clean(input.caller_ref,220)||null,
  allowed_followup_workers:['titan.worker.send_customer_message_agent','titan.worker.create_follow_up_agent','titan.worker.update_customer_agent'],
  requires_approval:true,grants_authority:false,authority_effect:false,execution_permitted:false};
}
export function planHumanEscalation(input={}){
 const b=requireBase(input); const reason=clean(input.reason,60).toLowerCase(); if(!RECOVERY_REASONS.has(reason)) throw new Error(`call-recovery-escalation-reason-invalid:${reason}`);
 const urgency=['provider_failure','customer_requested_human'].includes(reason)?'high':(reason==='agent_unresolved'?'medium':'normal');
 return {schema:'titan.workforce.voice-human-escalation.v1',...b,status:'ESCALATION_PROPOSED',reason,urgency,
  manager:CUSTOMER_CHAIN.manager,supervisor:CUSTOMER_CHAIN.supervisor,specialist: reason==='after_hours'?'titan.customer.after_hours_coordinator':CUSTOMER_CHAIN.customer_care,
  human_queue_ref:clean(input.human_queue_ref,220)||null,customer_ref:clean(input.customer_ref,220)||null,caller_ref:clean(input.caller_ref,220)||null,
  evidence_ref:clean(input.evidence_ref,260)||null,requires_human_acceptance:true,grants_authority:false,authority_effect:false,execution_permitted:false};
}
export function dedupeRecoveryAction(previous={},candidate={}){
 const a=clean(previous.company_id,128), b=clean(candidate.company_id,128); if(a&&b&&a!==b) throw new Error('call-recovery-company-mismatch');
 const key=clean(candidate.idempotency_key,220); if(!key) throw new Error('call-recovery-idempotency-key-required');
 const seen=Array.isArray(previous.processed_idempotency_keys)?previous.processed_idempotency_keys:[];
 if(seen.includes(key)) return {duplicate:true,apply:false,processed_idempotency_keys:seen,execution_permitted:false};
 return {duplicate:false,apply:true,processed_idempotency_keys:[...seen,key],execution_permitted:false};
}
export {CUSTOMER_CHAIN};
export default {detectCallRecoveryNeed,buildCallEvidenceEnvelope,planCallbackRecovery,planVoicemailHandoff,planHumanEscalation,dedupeRecoveryAction,CUSTOMER_CHAIN};
