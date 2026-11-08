// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/rebooking/rebooking-recurring-lifecycle.mjs
const LEGACY_KEYS=["tenant_company_id","tenant_id","account_id","business_id"];
const ACTIONS=new Set(["GENERATE_NEXT","SKIP","PAUSE","RESUME","CANCEL"]);
const ACTIVE_STATES=new Set(["ACTIVE","PAUSED","CANCELLED"]);
const req=(v,n)=>{if(typeof v!=="string"||!v.trim())throw new Error(`missing ${n}`);return v.trim()};
const rejectLegacy=i=>{for(const k of LEGACY_KEYS)if(i&&Object.prototype.hasOwnProperty.call(i,k))throw new Error(`legacy company boundary rejected: ${k}`)};
const uniq=a=>[...new Set((a||[]).filter(Boolean))].sort();
const parseDate=(v,n)=>{const s=req(v,n);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new Error(`invalid ${n}`);const d=new Date(`${s}T00:00:00Z`);if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s)throw new Error(`invalid ${n}`);return d};
const addDays=(iso,days)=>{const d=parseDate(iso,"date");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
const normalizeSchedule=(s,company_id)=>{if(!s||typeof s!=="object")throw new Error("missing recurring_schedule");rejectLegacy(s);if(s.company_id!==company_id)throw new Error("cross-company schedule");const schedule_id=req(s.schedule_id,"recurring_schedule.schedule_id");const customer_id=req(s.customer_id,"recurring_schedule.customer_id");const service_id=req(s.service_id,"recurring_schedule.service_id");const timezone=req(s.timezone,"recurring_schedule.timezone");const state=req(s.state,"recurring_schedule.state").toUpperCase();if(!ACTIVE_STATES.has(state))throw new Error("unsupported schedule state");const next_due_date=s.next_due_date?parseDate(s.next_due_date,"recurring_schedule.next_due_date").toISOString().slice(0,10):null;return{...s,schedule_id,customer_id,service_id,timezone,state,next_due_date}};
const verifyIntent=(i,company_id,schedule_id)=>{if(!i||typeof i!=="object")throw new Error("missing lifecycle_intent");rejectLegacy(i);if(i.company_id!==company_id)throw new Error("cross-company lifecycle intent");if(i.schedule_id!==schedule_id)throw new Error("lifecycle intent schedule mismatch");if(i.verified!==true)throw new Error("unverified lifecycle intent");const action=req(i.action,"lifecycle_intent.action").toUpperCase();if(!ACTIONS.has(action))throw new Error("unsupported lifecycle action");return{...i,action,intent_id:req(i.intent_id,"lifecycle_intent.intent_id"),producer:req(i.producer,"lifecycle_intent.producer")}};
const validateAuthority=(a,company_id,action,asOf)=>{if(!a)return{valid:false,reason:"FRESH_AUTHORITY_REQUIRED",evidence_ref:null};rejectLegacy(a);if(a.company_id!==company_id)throw new Error("cross-company authority");if(a.granted!==true)return{valid:false,reason:"AUTHORITY_NOT_GRANTED",evidence_ref:a.evidence_ref||null};const expected=action==="GENERATE_NEXT"?"rebooking.recurring.generate":"rebooking.recurring.lifecycle";if(a.scope!==expected)return{valid:false,reason:"AUTHORITY_SCOPE_MISMATCH",evidence_ref:a.evidence_ref||null};const checked=new Date(req(a.checked_at,"authority.checked_at"));if(Number.isNaN(checked.getTime()))throw new Error("invalid authority.checked_at");const max=Number.isInteger(a.max_age_seconds)&&a.max_age_seconds>0?a.max_age_seconds:300;if(Math.abs(asOf-checked)>max*1000)return{valid:false,reason:"AUTHORITY_STALE",evidence_ref:a.evidence_ref||null};return{valid:true,reason:null,evidence_ref:a.evidence_ref||null}};
const validateExistingInstances=(items,company_id,schedule_id)=>{const out=[];for(const e of items||[]){rejectLegacy(e);if(e.company_id!==company_id)throw new Error("cross-company existing instance");if(e.schedule_id!==schedule_id)continue;const due=req(e.due_date,"existing_instance.due_date");parseDate(due,"existing_instance.due_date");out.push({...e,due_date:due})}return out};
const holidaySet=(items,company_id)=>{const out=new Set();for(const h of items||[]){rejectLegacy(h);if(h.company_id&&h.company_id!==company_id)throw new Error("cross-company holiday");const d=req(h.date,"holiday.date");parseDate(d,"holiday.date");out.add(d)}return out};
const availabilitySet=(items,company_id,schedule)=>{const out=new Set();for(const a of items||[]){rejectLegacy(a);if(a.company_id!==company_id)throw new Error("cross-company availability");if(a.customer_id&&a.customer_id!==schedule.customer_id)continue;if(a.service_id&&a.service_id!==schedule.service_id)continue;const d=req(a.date,"availability.date");parseDate(d,"availability.date");if(a.available===true)out.add(d)}return out};
const reconcileDate=(due,holidays,available,maxShift)=>{if(!due)return{date:null,shift_days:0,reason:"MISSING_NEXT_DUE_DATE"};for(let shift=0;shift<=maxShift;shift++){const d=addDays(due,shift);if(holidays.has(d))continue;if(available.size&& !available.has(d))continue;return{date:d,shift_days:shift,reason:shift?"RECONCILED_FORWARD":"DUE_DATE_AVAILABLE"}}return{date:null,shift_days:null,reason:"NO_RECONCILED_DATE_WITHIN_WINDOW"}};
export function buildRebookingRecurringLifecycle(input={}){
  rejectLegacy(input);
  const company_id=req(input.company_id,"company_id");
  const asOf=new Date(req(input.as_of_datetime,"as_of_datetime"));if(Number.isNaN(asOf.getTime()))throw new Error("invalid as_of_datetime");
  const schedule=normalizeSchedule(input.recurring_schedule,company_id);
  const intent=verifyIntent(input.lifecycle_intent,company_id,schedule.schedule_id);
  const action=intent.action;
  const reasons=[];
  const authority=validateAuthority(input.authority_check,company_id,action,asOf);
  const existing=validateExistingInstances(Array.isArray(input.existing_instances)?input.existing_instances:[],company_id,schedule.schedule_id);
  const holidays=holidaySet(Array.isArray(input.holidays)?input.holidays:[],company_id);
  const availability=availabilitySet(Array.isArray(input.availability)?input.availability:[],company_id,schedule);
  const maxShift=Number.isInteger(input.max_forward_shift_days)&&input.max_forward_shift_days>=0&&input.max_forward_shift_days<=60?input.max_forward_shift_days:14;
  const base={
    schema:"titan.workforce.starter.rebooking-recurring-lifecycle.v1",
    lifecycle_id:`rebook-recurring:${company_id}:${schedule.schedule_id}:${intent.intent_id}:${action}`,
    company_id,customer_id:schedule.customer_id,service_id:schedule.service_id,schedule_id:schedule.schedule_id,timezone:schedule.timezone,action,
    source_intent:{intent_id:intent.intent_id,verified:true,producer:intent.producer,evidence_ref:intent.evidence_ref||null},
    canonical_engine:"titan.workforce.schedule-recurrence.v1",
    current_state:schedule.state,target_state:schedule.state,state:"REVIEW",reasons:[],
    lifecycle_handoff:null,generation_handoff:null,reconciliation:null,
    evidence_refs:uniq([intent.evidence_ref,authority.evidence_ref,...(Array.isArray(input.evidence_refs)?input.evidence_refs:[])]),
    mutates_schedule:false,creates_schedule:false,creates_job:false,creates_booking:false,execution_permitted:false,grants_authority:false,identity_is_authority:false,requires_canonical_commit:true
  };
  if(action==="PAUSE"){
    if(schedule.state==="CANCELLED")reasons.push("CANCELLED_SCHEDULE_IMMUTABLE");
    if(schedule.state==="PAUSED")reasons.push("ALREADY_PAUSED");
    base.target_state="PAUSED";
    base.lifecycle_handoff={action:"PAUSE",idempotency_key:`rebook-recurring:${company_id}:${schedule.schedule_id}:pause`,requires_fresh_authority_evaluation:true};
  } else if(action==="RESUME"){
    if(schedule.state==="CANCELLED")reasons.push("CANCELLED_SCHEDULE_IMMUTABLE");
    if(schedule.state!=="PAUSED")reasons.push("NOT_PAUSED");
    base.target_state="ACTIVE";
    base.lifecycle_handoff={action:"RESUME",idempotency_key:`rebook-recurring:${company_id}:${schedule.schedule_id}:resume`,requires_fresh_authority_evaluation:true};
  } else if(action==="CANCEL"){
    if(schedule.state==="CANCELLED")reasons.push("ALREADY_CANCELLED");
    base.target_state="CANCELLED";
    base.lifecycle_handoff={action:"CANCEL",idempotency_key:`rebook-recurring:${company_id}:${schedule.schedule_id}:cancel`,requires_fresh_authority_evaluation:true};
  } else if(action==="SKIP"){
    if(schedule.state!=="ACTIVE")reasons.push(schedule.state==="PAUSED"?"SCHEDULE_PAUSED":"SCHEDULE_CANCELLED");
    const due=req(intent.due_date||schedule.next_due_date,"lifecycle_intent.due_date");parseDate(due,"lifecycle_intent.due_date");
    const duplicate=existing.some(e=>e.due_date===due&&["SKIPPED","GENERATED","BOOKED","COMPLETED"].includes(String(e.state||"").toUpperCase()));
    if(duplicate)reasons.push("INSTANCE_ALREADY_RESOLVED");
    base.lifecycle_handoff={action:"SKIP_INSTANCE",due_date:due,idempotency_key:`rebook-recurring:${company_id}:${schedule.schedule_id}:${due}:skip`,requires_fresh_authority_evaluation:true};
  } else {
    if(schedule.state!=="ACTIVE")reasons.push(schedule.state==="PAUSED"?"SCHEDULE_PAUSED":"SCHEDULE_CANCELLED");
    if(!schedule.next_due_date)reasons.push("MISSING_NEXT_DUE_DATE");
    let recon=null;
    if(schedule.next_due_date){recon=reconcileDate(schedule.next_due_date,holidays,availability,maxShift);base.reconciliation={original_due_date:schedule.next_due_date,reconciled_date:recon.date,shift_days:recon.shift_days,reason:recon.reason,holiday_checked:true,availability_checked:true};if(!recon.date)reasons.push(recon.reason)}
    if(recon?.date){
      const duplicate=existing.some(e=>e.due_date===recon.date&&["GENERATED","BOOKED","COMPLETED","PENDING"].includes(String(e.state||"").toUpperCase()));
      if(duplicate)reasons.push("DUPLICATE_INSTANCE_SUPPRESSED");
      base.generation_handoff={action:"GENERATE_CANONICAL_INSTANCE",due_date:recon.date,idempotency_key:`rebook-recurring:${company_id}:${schedule.schedule_id}:${recon.date}:generate`,requires_authoritative_duplicate_check:true,requires_fresh_authority_evaluation:true,canonical_engine:"titan.workforce.schedule-recurrence.v1"};
    }
  }
  if(!authority.valid)reasons.push(authority.reason);
  base.reasons=uniq(reasons);
  base.state=reasons.length?(reasons.some(r=>["DUPLICATE_INSTANCE_SUPPRESSED","INSTANCE_ALREADY_RESOLVED","ALREADY_PAUSED","ALREADY_CANCELLED"].includes(r))?"NOOP_IDEMPOTENT":"REVIEW"):"READY_FOR_CANONICAL_HANDOFF";
  return base;
}
