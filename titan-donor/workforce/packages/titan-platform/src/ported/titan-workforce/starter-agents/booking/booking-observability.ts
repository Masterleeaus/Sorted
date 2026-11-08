// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/booking/booking-observability.mjs
const text=(v,n)=>{const s=String(v??'').trim();if(!s)throw new Error(`${n}-required`);return s};
export function createBookingObservation(input={}){
 const company_id=text(input.company_id,'company-id'),correlation_id=text(input.correlation_id,'correlation-id'),event=text(input.event,'event');
 const allowed=['intent_created','availability_checked','hold_created','booking_confirmed','booking_conflict','delivery_unknown','reconciliation_required','handoff_created'];
 if(!allowed.includes(event))throw new Error('booking-observation-event-invalid');
 return Object.freeze({schema:'titan.booking.observation.v1',company_id,correlation_id,event,booking_ref:input.booking_ref??null,intent_id:input.intent_id??null,provider:input.provider??null,reason:input.reason??null,occurred_at:input.occurred_at??new Date().toISOString(),authority_neutral:true,grants_authority:false,direct_mutation:false});
}
export function summarizeBookingMetrics(events=[],company_id){
 const c=text(company_id,'company-id');const own=events.filter(e=>e?.schema==='titan.booking.observation.v1'&&e.company_id===c);const counts={};for(const e of own)counts[e.event]=(counts[e.event]??0)+1;
 return Object.freeze({schema:'titan.booking.metrics.v1',company_id:c,total_events:own.length,confirmed:counts.booking_confirmed??0,conflicts:counts.booking_conflict??0,delivery_unknown:counts.delivery_unknown??0,reconciliation_required:counts.reconciliation_required??0,handoffs:counts.handoff_created??0,counts:Object.freeze(counts),authority_neutral:true});
}
export function bookingDiagnosticSnapshot(input={}){
 const company_id=text(input.company_id,'company-id');const operations=Array.isArray(input.operations)?input.operations:[];const holds=Array.isArray(input.holds)?input.holds:[];const reconciliations=Array.isArray(input.reconciliations)?input.reconciliations:[];
 const own=x=>String(x?.company_id??'')===company_id;
 return Object.freeze({schema:'titan.booking.diagnostics.v1',company_id,active_holds:holds.filter(x=>own(x)&&['held','accepted'].includes(x.state)).length,uncertain_operations:operations.filter(x=>own(x)&&x.state==='delivery_unknown').length,verification_failures:operations.filter(x=>own(x)&&x.state==='verification_failed').length,pending_reconciliations:reconciliations.filter(x=>own(x)&&x.scheduling_review_required).length,grants_authority:false,direct_mutation:false});
}
