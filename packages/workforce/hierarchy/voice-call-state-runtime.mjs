const clean=(v,max=240)=>String(v??'').trim().slice(0,max);
const STATES=['prepared','placing','ringing','connected','transferred','voicemail','ended','failed','uncertain'];
const terminal=new Set(['ended','failed']);
const allowed=new Map([
 ['prepared',new Set(['placing','failed'])],
 ['placing',new Set(['ringing','connected','voicemail','failed','uncertain'])],
 ['ringing',new Set(['connected','voicemail','ended','failed','uncertain'])],
 ['connected',new Set(['transferred','voicemail','ended','failed','uncertain'])],
 ['transferred',new Set(['connected','ended','failed','uncertain'])],
 ['voicemail',new Set(['ended','failed','uncertain'])],
 ['uncertain',new Set(['ringing','connected','transferred','voicemail','ended','failed'])],
 ['ended',new Set()],['failed',new Set()]
]);
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
export function normalizeCallReceipt(input={}){
 const company_id=clean(input.company_id,128); if(!validCompany(company_id)) throw new Error('call-receipt-company_id-required');
 const operation_id=clean(input.operation_id,180); if(!operation_id) throw new Error('call-receipt-operation_id-required');
 const call_ref=clean(input.call_ref,220); if(!call_ref) throw new Error('call-receipt-call_ref-required');
 const state=clean(input.state,40).toLowerCase(); if(!STATES.includes(state)) throw new Error(`call-receipt-state-invalid:${state}`);
 return {schema:'titan.workforce.voice-call-receipt.v1',company_id,operation_id,call_ref,state,provider:clean(input.provider,80)||null,
  external_id:clean(input.external_id,220)||null,idempotency_key:clean(input.idempotency_key,220)||null,provider_event_id:clean(input.provider_event_id,220)||null,
  failure_code:clean(input.failure_code,120)||null,reconciliation_required:Boolean(input.reconciliation_required===true||state==='uncertain'),
  timestamp:clean(input.timestamp,80)||null,grants_authority:false,authority_effect:false};
}
export function applyCallReceipt(current={},rawReceipt={}){
 const receipt=normalizeCallReceipt(rawReceipt); const company_id=clean(current.company_id||receipt.company_id,128);
 if(company_id!==receipt.company_id) throw new Error('call-state-company-mismatch');
 const prior=clean(current.state||'prepared',40).toLowerCase(); if(!STATES.includes(prior)) throw new Error('call-state-prior-invalid');
 if(current.call_ref&&clean(current.call_ref,220)!==receipt.call_ref) throw new Error('call-state-call-ref-mismatch');
 if(terminal.has(prior) && receipt.state!==prior) return {...current,duplicate_or_stale:true,receipt_applied:false,last_receipt:receipt,execution_permitted:false};
 if(receipt.provider_event_id && Array.isArray(current.provider_event_ids) && current.provider_event_ids.includes(receipt.provider_event_id)) return {...current,duplicate_or_stale:true,receipt_applied:false,last_receipt:receipt,execution_permitted:false};
 if(prior!==receipt.state && !allowed.get(prior)?.has(receipt.state)) throw new Error(`call-state-transition-invalid:${prior}->${receipt.state}`);
 const ids=[...(current.provider_event_ids||[])]; if(receipt.provider_event_id) ids.push(receipt.provider_event_id);
 return {schema:'titan.workforce.voice-call-state.v1',company_id,call_ref:receipt.call_ref,state:receipt.state,operation_id:receipt.operation_id,
  idempotency_key:receipt.idempotency_key||current.idempotency_key||null,provider_event_ids:ids,last_receipt:receipt,reconciliation_required:receipt.reconciliation_required,
  grants_authority:false,authority_effect:false,execution_permitted:false,receipt_applied:true,duplicate_or_stale:false};
}
export function decideCallRetry(input={}){
 const state=clean(input.state,40).toLowerCase(); const attempts=Number(input.attempts||0); const max_attempts=Math.max(1,Number(input.max_attempts||3));
 const hasReceipt=Boolean(input.receipt); const reconciliation=Boolean(input.reconciliation_required===true||state==='uncertain');
 const sameKey=Boolean(clean(input.idempotency_key,220));
 if(['ringing','connected','transferred','voicemail','ended'].includes(state)) return {retry:false,reason:'CALL_ALREADY_HAS_LIVE_OR_TERMINAL_STATE',redial_permitted:false};
 if(reconciliation) return {retry:false,reason:'RECONCILIATION_REQUIRED_BEFORE_RETRY',redial_permitted:false};
 if(hasReceipt && state!=='failed') return {retry:false,reason:'RECEIPT_PRESENT_NO_RETRY',redial_permitted:false};
 if(attempts>=max_attempts) return {retry:false,reason:'MAX_ATTEMPTS_REACHED',redial_permitted:false};
 if(!sameKey) return {retry:false,reason:'IDEMPOTENCY_KEY_REQUIRED',redial_permitted:false};
 if(state==='failed'||state==='prepared') return {retry:true,reason:'SAFE_RETRY_WITH_SAME_IDEMPOTENCY_KEY',redial_permitted:true};
 return {retry:false,reason:'STATE_NOT_RETRYABLE',redial_permitted:false};
}
export function createCallState(input={}){
 const company_id=clean(input.company_id,128); if(!validCompany(company_id)) throw new Error('call-state-company_id-required');
 const call_ref=clean(input.call_ref,220); if(!call_ref) throw new Error('call-state-call_ref-required');
 const idempotency_key=clean(input.idempotency_key,220); if(!idempotency_key) throw new Error('call-state-idempotency-key-required');
 return {schema:'titan.workforce.voice-call-state.v1',company_id,call_ref,state:'prepared',operation_id:clean(input.operation_id,180)||null,idempotency_key,provider_event_ids:[],reconciliation_required:false,grants_authority:false,authority_effect:false,execution_permitted:false};
}
export {STATES as VOICE_CALL_STATES};
export default {normalizeCallReceipt,applyCallReceipt,decideCallRetry,createCallState,VOICE_CALL_STATES:STATES};
