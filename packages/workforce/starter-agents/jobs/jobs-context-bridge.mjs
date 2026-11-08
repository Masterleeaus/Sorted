const clean=v=>typeof v==='string'?v.trim():'';const arr=v=>Array.isArray(v)?v:[];
function company(x){for(const k of ['tenant_id','tenantId','tenant_company_id'])if(x?.[k]!=null)throw new Error(`jobs-context-legacy-tenant-forbidden:${k}`);const c=clean(x?.company_id);if(!c)throw new Error('jobs-context-company-id-required');return c;}
function sameCompany(c,obj,label){if(obj?.company_id&&clean(obj.company_id)!==c)throw new Error(`jobs-context-cross-company:${label}`);}
export function compileJobCreationContext(input={}){
 const company_id=company(input);const booking=input.booking||{};const schedule=input.schedule||{};const dispatch=input.dispatch||{};for(const [o,l] of [[booking,'booking'],[schedule,'schedule'],[dispatch,'dispatch']])sameCompany(company_id,o,l);
 const booking_id=clean(booking.booking_id||input.booking_id),appointment_id=clean(schedule.appointment_id||booking.appointment_id||input.appointment_id),dispatch_id=clean(dispatch.dispatch_id||input.dispatch_id),service_request_id=clean(booking.service_request_id||input.service_request_id),worker_ids=[...new Set(arr(dispatch.worker_ids?.length?dispatch.worker_ids:schedule.worker_ids).map(clean).filter(Boolean))];
 if(!booking_id&&!appointment_id&&!service_request_id)throw new Error('jobs-context-upstream-reference-required');
 const source_ref=booking_id||appointment_id||service_request_id;const operation_id=clean(input.operation_id)||`create:${source_ref}`;
 const idempotency_key=`jobs-create:${company_id}:${source_ref}`;
 return {schema:'titan.zero.jobs.creation-context.v1',company_id,operation_id,idempotency_key,capability:'crm.work_order.create',canonical_owner:'Titan Field',references:{booking_id:booking_id||null,appointment_id:appointment_id||null,dispatch_id:dispatch_id||null,service_request_id:service_request_id||null},assignment:{worker_ids,scheduled_start:schedule.scheduled_start||booking.scheduled_start||null,scheduled_end:schedule.scheduled_end||booking.scheduled_end||null},customer_id:clean(booking.customer_id||input.customer_id)||null,service_id:clean(booking.service_id||input.service_id)||null,property_id:clean(booking.property_id||input.property_id)||null,address:clean(booking.address||input.address)||null,initial_state:worker_ids.length?'assigned':'planned',authority_granted:false,execution_permitted:false,requires_authority_gate:true,creates_parallel_record:false};
}
export function dedupeJobCreation(existing=[],compiled={}){
 const hit=arr(existing).find(x=>x?.company_id===compiled.company_id&&x?.idempotency_key===compiled.idempotency_key);
 return hit?{action:'REUSE_EXISTING',job_ref:hit.job_ref||hit.job_id||null,idempotency_key:compiled.idempotency_key}:{action:'CREATE_VIA_TITAN_FIELD',job_ref:null,idempotency_key:compiled.idempotency_key};
}
