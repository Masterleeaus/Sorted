// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/booking/booking-orchestrator.mjs
const req=(v,n)=>{const s=String(v??'').trim();if(!s)throw new Error(`${n}-required`);return s};
export function buildBookingExecutionPlan(input={}){
 const company_id=req(input.company_id,'company-id'); const intent_id=req(input.intent_id,'intent-id'); const correlation_id=req(input.correlation_id,'correlation-id'); const idempotency_key=req(input.idempotency_key,'idempotency-key');
 if(input.identity_authorized===true) throw new Error('identity-cannot-grant-authority');
 return Object.freeze({schema:'titan.booking.execution-plan.v1',company_id,intent_id,correlation_id,idempotency_key,worker_id:req(input.worker_id??'booking-agent','worker-id'),steps:Object.freeze([
  {id:'revalidate',kind:'domain_read',capability:'bookings.lifecycle.read',required:true},
  {id:'confirm_booking',kind:'governed_command',capability:'crm.appointment.create',required:true,requires_authority_decision:true,requires_authoritative_receipt:true},
  {id:'verify_booking',kind:'domain_verify',capability:'bookings.lifecycle.read',required:true},
  {id:'notify_customer',kind:'governed_command',capability:'communications.send',required:false,after:'verify_booking'}
 ]),direct_mutation:false,grants_authority:false});
}
export async function runBookingExecutionPlan(plan,ports={}){
 if(plan?.schema!=='titan.booking.execution-plan.v1')throw new Error('booking-execution-plan-required');
 if(typeof ports.revalidate!=='function'||typeof ports.executeGoverned!=='function'||typeof ports.verify!=='function')throw new Error('booking-execution-ports-required');
 const current=await ports.revalidate(plan); if(!current?.ok) return Object.freeze({ok:false,state:'conflict',reason:current?.reason??'revalidation_failed',direct_mutation:false});
 const receipt=await ports.executeGoverned({company_id:plan.company_id,capability:'crm.appointment.create',correlation_id:plan.correlation_id,idempotency_key:plan.idempotency_key,intent_id:plan.intent_id,requires_authority_decision:true});
 if(!receipt?.ok||!receipt.receipt_id) return Object.freeze({ok:false,state:'failed',reason:'authoritative_receipt_required',direct_mutation:false});
 const verified=await ports.verify({...plan,receipt}); if(!verified?.ok||!verified.booking_ref) return Object.freeze({ok:false,state:'conflict',reason:'post_action_verification_failed',receipt_id:receipt.receipt_id,direct_mutation:false});
 let notification=null; if(typeof ports.notify==='function') notification=await ports.notify({company_id:plan.company_id,correlation_id:plan.correlation_id,booking_ref:verified.booking_ref});
 return Object.freeze({ok:true,state:'confirmed',booking_ref:verified.booking_ref,receipt_id:receipt.receipt_id,notification,direct_mutation:false,grants_authority:false});
}
