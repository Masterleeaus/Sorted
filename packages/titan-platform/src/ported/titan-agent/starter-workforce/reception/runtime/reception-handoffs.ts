// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-agent/starter-workforce/reception/runtime/reception-handoffs.mjs
const TARGETS = Object.freeze({
  sales: 'titan.sales.sales_coordinator',
  booking: 'titan.customer.booking_coordinator',
  customer_care: 'titan.customer.customer_care_coordinator',
});
const TERMINAL = new Set(['acknowledged','completed','cancelled']);
const LEGACY = new Set(['tenant_id','tenant_company_id','tenant_company','tenant','tenantCompanyId','organisation_id','organization_id','workspace_tenant_id']);
const clean=(v,max=240)=>typeof v==='string'?v.trim().replace(/\s+/g,' ').slice(0,max):'';
const list=(v,max=32,len=240)=>Object.freeze([...new Set((Array.isArray(v)?v:[]).map(x=>clean(typeof x==='string'?x:(x?.id??x?.ref??''),len)).filter(Boolean))].slice(0,max));
function company(v){const id=clean(v,128);if(!id)throw new TypeError('company_id is required');return id;}
function rejectLegacy(v,path='handoff'){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}for(const[k,x]of Object.entries(v)){if(LEGACY.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(x,`${path}.${k}`);}}
function target(v){const t=clean(v,40).toLowerCase();if(!TARGETS[t])throw new Error(`unsupported-reception-handoff-target:${t||'missing'}`);return t;}
function sameCompany(value, expected, label){if(value!=null&&clean(value,128)&&company(value)!==expected)throw new Error(`reception-handoff-cross-company-${label}`);}
function stableId(company_id,interaction_id,to){return `reception:${company_id}:${interaction_id}:${to}`;}
function validatePacket(packet){
  if(!packet||packet.schema!=='titan.zero.reception.worker-handoff/v1')throw new TypeError('Reception handoff packet required');
  const company_id=company(packet.company_id);const to=target(packet.target_worker);
  const expected=stableId(company_id,clean(packet.subject?.interaction_id,180),to);
  if(!clean(packet.subject?.interaction_id,180)||packet.handoff_id!==expected||packet.dedupe_key!==expected)throw new Error('reception-handoff-packet-integrity-failed');
  if(packet.from_worker_actor_id!=='titan.customer.receptionist'||packet.to_worker_actor_id!==TARGETS[to])throw new Error('reception-handoff-packet-route-integrity-failed');
  if(packet.grants_authority!==false||packet.direct_mutation!==false)throw new Error('reception-handoff-packet-authority-integrity-failed');
  sameCompany(packet.subject?.company_id,company_id,'packet-subject');
  return company_id;
}
function boundedSubject(input, company_id, to){const q=input.qualification&&typeof input.qualification==='object'?input.qualification:{};sameCompany(q.company_id,company_id,'qualification');return Object.freeze({
  kind:'reception_enquiry',
  target:to,
  interaction_id:clean(input.interaction_id,180),
  conversation_id:clean(input.conversation_id??q.conversation_id,180)||null,
  intent:clean(input.intent,160)||null,
  summary:clean(input.summary??q.summary,800)||null,
  urgency:clean(input.urgency??q.urgency,40)||'unknown',
  contact:Object.freeze({phone:clean(q.contact?.phone,80)||null,email:clean(q.contact?.email,320)||null,preferred_channel:clean(q.contact?.preferred_channel,40)||null}),
  service:Object.freeze({requested_service:clean(q.service?.requested_service,240)||null,service_variant:clean(q.service?.service_variant,240)||null}),
  location:Object.freeze({address:clean(q.location?.address,300)||null,suburb:clean(q.location?.suburb,120)||null,state:clean(q.location?.state,80)||null,postcode:clean(q.location?.postcode,20)||null}),
  timing:Object.freeze({requested_date:clean(q.timing?.requested_date,80)||null,requested_window:clean(q.timing?.requested_window,160)||null,flexibility_note:clean(q.timing?.flexibility_note,240)||null}),
  source:Object.freeze({channel:clean(q.source?.channel,40)||null,campaign:clean(q.source?.campaign,160)||null,referrer:clean(q.source?.referrer,240)||null}),
  downstream_action_requested:clean(input.requested_action,120)||null,
  downstream_action_completed:false,
});}

export function buildReceptionWorkerHandoffPacket(input={}){
  rejectLegacy(input);const company_id=company(input.company_id);const to=target(input.target_worker??input.target);const interaction_id=clean(input.interaction_id,180);if(!interaction_id)throw new Error('interaction_id is required');
  const handoff_id=stableId(company_id,interaction_id,to);const trace_id=clean(input.trace_id,180)||handoff_id;const correlation_id=clean(input.correlation_id,180)||interaction_id;
  return Object.freeze({
    schema:'titan.zero.reception.worker-handoff/v1',handoff_id,company_id,
    from_worker_actor_id:'titan.customer.receptionist',to_worker_actor_id:TARGETS[to],target_worker:to,
    subject:boundedSubject(input,company_id,to),evidence_refs:list(input.evidence_refs),decision_refs:list(input.decision_refs),execution_refs:list(input.execution_refs),outcome_refs:list(input.outcome_refs),
    trace_id,correlation_id,causation_id:clean(input.causation_id,180)||null,created_at:clean(input.created_at,64)||new Date().toISOString(),immutable:true,
    dedupe_key:handoff_id,grants_authority:false,direct_mutation:false,requires_authoritative_dispatch_receipt:true,
  });
}

export function createReceptionPendingHandoff(packet, prior=null){
  const company_id=validatePacket(packet);
  if(prior){sameCompany(prior.company_id,company_id,'state');if(prior.handoff_id!==packet.handoff_id)throw new Error('reception-handoff-state-id-mismatch');return Object.freeze({...prior,packet});}
  return Object.freeze({schema:'titan.zero.reception.pending-handoff/v1',company_id,handoff_id:packet.handoff_id,dedupe_key:packet.dedupe_key,packet,status:'pending',attempt_count:0,last_event_id:null,processed_event_ids:Object.freeze([]),dispatch_receipt:null,target_ack:null,target_outcome:null,replay_policy:'same_dedupe_key_only',automatic_replay_allowed:true,unsafe_replay_blocked:false,authority_granted:false,execution_permitted:false});
}

export function applyReceptionHandoffEvent(state,event={}){
  if(!state||state.schema!=='titan.zero.reception.pending-handoff/v1')throw new TypeError('Pending Reception handoff state required');rejectLegacy(event);const company_id=company(state.company_id);sameCompany(event.company_id,company_id,'event');if(event.handoff_id&&clean(event.handoff_id,300)!==state.handoff_id)throw new Error('reception-handoff-event-id-mismatch');
  validatePacket(state.packet);if(state.dedupe_key!==state.packet.dedupe_key||state.handoff_id!==state.packet.handoff_id)throw new Error('reception-handoff-state-integrity-failed');
  const event_id=clean(event.event_id,220);if(!event_id)throw new Error('event_id is required');const seen=new Set(Array.isArray(state.processed_event_ids)?state.processed_event_ids:[]);if(seen.has(event_id))return state;seen.add(event_id);
  const type=clean(event.type,80).toLowerCase();let status=state.status,attempt_count=state.attempt_count,receipt=state.dispatch_receipt,ack=state.target_ack,outcome=state.target_outcome,automatic=true,blocked=false;
  if(type==='dispatch_submitted'){if(TERMINAL.has(status)||status==='dispatched'||status==='dispatch_unknown')return Object.freeze({...state,last_event_id:event_id});status='dispatching';attempt_count+=1;automatic=false;}
  else if(type==='dispatch_receipt'){
    const rs=clean(event.status,40).toLowerCase();if(!['accepted','failed','rejected'].includes(rs))throw new Error(`invalid-handoff-receipt-status:${rs||'missing'}`);
    receipt=Object.freeze({event_id,status:rs,receipt_ref:clean(event.receipt_ref,240)||null,received_at:clean(event.received_at,64)||new Date().toISOString()});
    if(rs==='accepted'){status='dispatched';automatic=false;blocked=true;}else{status='failed';automatic=true;blocked=false;}
  }
  else if(type==='dispatch_unknown'){status='dispatch_unknown';automatic=false;blocked=true;}
  else if(type==='target_ack'){if(!receipt||receipt.status!=='accepted')throw new Error('target-ack-requires-accepted-dispatch-receipt');status='acknowledged';ack=Object.freeze({event_id,ack_ref:clean(event.ack_ref,240)||null,received_at:clean(event.received_at,64)||new Date().toISOString()});automatic=false;blocked=true;}
  else if(type==='target_outcome'){if(!receipt||receipt.status!=='accepted')throw new Error('target-outcome-requires-accepted-dispatch-receipt');const os=clean(event.status,40).toLowerCase();if(!['completed','declined','failed','cancelled'].includes(os))throw new Error(`invalid-target-outcome-status:${os||'missing'}`);outcome=Object.freeze({event_id,status:os,outcome_ref:clean(event.outcome_ref,240)||null,received_at:clean(event.received_at,64)||new Date().toISOString()});status=os==='completed'?'completed':os;automatic=false;blocked=true;}
  else throw new Error(`unsupported-handoff-event:${type||'missing'}`);
  return Object.freeze({...state,status,attempt_count,last_event_id:event_id,processed_event_ids:Object.freeze([...seen].slice(-500)),dispatch_receipt:receipt,target_ack:ack,target_outcome:outcome,automatic_replay_allowed:automatic,unsafe_replay_blocked:blocked,authority_granted:false,execution_permitted:false});
}

export function recoverReceptionHandoff(state={}){
  if(!state||state.schema!=='titan.zero.reception.pending-handoff/v1')throw new TypeError('Pending Reception handoff state required');const company_id=company(state.company_id);validatePacket(state.packet);if(state.packet.company_id!==company_id||state.handoff_id!==state.packet.handoff_id||state.dedupe_key!==state.packet.dedupe_key)throw new Error('reception-handoff-state-integrity-failed');
  const accepted=state.dispatch_receipt?.status==='accepted';const terminal=TERMINAL.has(state.status)||state.status==='declined';
  if(accepted||terminal||state.status==='dispatch_unknown')return Object.freeze({schema:'titan.zero.reception.handoff-recovery/v1',company_id:state.company_id,handoff_id:state.handoff_id,action:state.status==='dispatch_unknown'?'reconcile_before_retry':'do_not_replay',reason:state.status==='dispatch_unknown'?'dispatch_outcome_unknown':'authoritative_delivery_or_terminal_state_exists',retry_allowed:false,dedupe_key:state.dedupe_key,authority_granted:false});
  if(state.status==='dispatching')return Object.freeze({schema:'titan.zero.reception.handoff-recovery/v1',company_id:state.company_id,handoff_id:state.handoff_id,action:'reconcile_before_retry',reason:'dispatch_submitted_without_authoritative_receipt',retry_allowed:false,dedupe_key:state.dedupe_key,authority_granted:false});
  return Object.freeze({schema:'titan.zero.reception.handoff-recovery/v1',company_id:state.company_id,handoff_id:state.handoff_id,action:'retry_same_handoff',reason:'no_authoritative_delivery_receipt',retry_allowed:true,dedupe_key:state.dedupe_key,authority_granted:false});
}

export function buildReceptionHandoffDispatchCommand(state={}){
  const recovery=recoverReceptionHandoff(state);if(!recovery.retry_allowed)throw new Error(`reception-handoff-dispatch-blocked:${recovery.action}`);
  return Object.freeze({schema:'titan.zero.reception.handoff-dispatch-command/v1',company_id:state.company_id,capability:'reception.request_handoff',handoff_id:state.handoff_id,dedupe_key:state.dedupe_key,packet:state.packet,
    target_worker:state.packet.target_worker,dispatch_via_existing_workforce_runtime:true,requires_authoritative_dispatch_receipt:true,downstream_business_effect_unconfirmed:true,automatic_execution:false,authority_granted:false,execution_permitted:false,grants_authority:false});
}

export const RECEPTION_HANDOFF_TARGETS=Object.freeze(Object.keys(TARGETS));
