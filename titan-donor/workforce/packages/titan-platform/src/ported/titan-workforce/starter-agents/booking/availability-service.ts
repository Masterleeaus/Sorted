// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-workforce/starter-agents/booking/availability-service.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
const text=(v,n)=>{const s=String(v??'').trim();if(!s)throw new Error(`${n}-required`);return s}; const iso=v=>{const ms=Date.parse(v);if(!Number.isFinite(ms))throw new Error('invalid-date-time');return new Date(ms).toISOString()};
export function normalizeAvailabilitySlot(raw={},ctx={}){
 const observedAt=iso(ctx.observed_at??new Date().toISOString()); const ttl=Math.max(1000,Number(ctx.ttl_ms??300000)); const starts=iso(raw.starts_at??raw.start); const ends=iso(raw.ends_at??raw.end); if(Date.parse(ends)<=Date.parse(starts))throw new Error('slot-end-before-start');
 return Object.freeze({schema:'titan.booking.availability-slot.v1',company_id:text(ctx.company_id,'company-id'),provider:text(ctx.provider,'provider'),provider_slot_id:text(raw.provider_slot_id??raw.id,'provider-slot-id'),provider_revision:text(raw.provider_revision??raw.revision??raw.etag,'provider-revision'),starts_at:starts,ends_at:ends,timezone:text(raw.timezone??ctx.timezone,'timezone'),observed_at:observedAt,expires_at:new Date(Date.parse(observedAt)+ttl).toISOString(),capacity:raw.capacity==null?null:Number(raw.capacity),bookable:raw.bookable!==false,synthetic:false,grants_authority:false});
}
export function assertFreshSlot(slot,now=new Date().toISOString()){
 if(slot?.schema!=='titan.booking.availability-slot.v1')throw new Error('authoritative-slot-required'); if(slot.synthetic!==false)throw new Error('synthetic-slot-denied'); if(Date.parse(slot.expires_at)<=Date.parse(now))throw new Error('stale-slot-denied'); if(slot.bookable!==true)throw new Error('slot-not-bookable'); return slot;
}
export async function lookupAvailability(input={},ports={}){
 const company_id=text(input.company_id,'company-id'); const provider=text(input.provider,'provider'); if(typeof ports.fetchAvailability!=='function')throw new Error('availability-provider-required');
 let response; try{response=await ports.fetchAvailability({company_id,provider,service_id:text(input.service_id,'service-id'),site_id:text(input.site_id,'site-id'),window:input.window??null,correlation_id:text(input.correlation_id,'correlation-id')});}catch(e){return Object.freeze({ok:false,state:'provider_unavailable',slots:[],reason:String(e?.message??e),synthetic_slots:false});}
 if(!response?.ok||!Array.isArray(response.slots))return Object.freeze({ok:false,state:'provider_unavailable',slots:[],reason:response?.reason??'availability_unavailable',synthetic_slots:false});
 const slots=response.slots.map(s=>normalizeAvailabilitySlot(s,{company_id,provider,timezone:response.timezone??input.timezone,observed_at:response.observed_at??input.now,ttl_ms:response.ttl_ms??input.ttl_ms})).filter(s=>s.bookable);
 return Object.freeze({ok:true,state:slots.length?'available':'no_availability',slots,provider_revision:response.provider_revision??null,synthetic_slots:false});
}
