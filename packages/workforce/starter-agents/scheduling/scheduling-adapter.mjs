const text=(v,n)=>{const s=String(v??'').trim();if(!s)throw new Error(`${n}-required`);return s};
const list=v=>Array.isArray(v)?v:[];
export function buildSchedulingProposal(input={},capacitySnapshot={},assignmentDecision=null){const company_id=text(input.company_id,'company-id');if(capacitySnapshot?.schema!=='titan.workforce.workload-capacity.v1'||capacitySnapshot.company_id!==company_id)throw new Error('company-capacity-snapshot-required');if(assignmentDecision&&String(assignmentDecision.company_id)!==company_id)throw new Error('cross-company-assignment-denied');const required=Math.max(0,Number(input.required_capacity_units??1)||1);const eligible=list(capacitySnapshot.worker_capacity).filter(w=>w&&w.available_units>=required&&w.state!=='OVERLOADED').map(w=>({worker_id:String(w.worker_id),available_units:Number(w.available_units||0),capacity_units:Number(w.capacity_units||0),utilization:Number(w.utilization||0),grants_authority:false})).sort((a,b)=>a.utilization-b.utilization||a.worker_id.localeCompare(b.worker_id));return Object.freeze({schema:'titan.scheduling.proposal.v1',company_id,schedule_intent_id:text(input.schedule_intent_id,'schedule-intent-id'),work_item_id:text(input.work_item_id,'work-item-id'),requested_window:input.requested_window??null,required_capacity_units:required,eligible_workers:eligible,assignment_reference:assignmentDecision?{assignment_id:String(assignmentDecision.assignment_id),worker_id:String(assignmentDecision.worker_id),decision_state:String(assignmentDecision.decision_state)}:null,conflict:eligible.length===0?'NO_CAPACITY':null,requires_governed_assignment:true,requires_fresh_authority_evaluation:true,automatic_assignment:false,direct_mutation:false,grants_authority:false});}
export function buildRescheduleRequest(state,reason,input={}){if(state?.schema!=='titan.scheduling.intent.v1')throw new Error('scheduling-intent-required');if(input.company_id&&String(input.company_id)!==state.company_id)throw new Error('cross-company-reschedule-denied');return Object.freeze({schema:'titan.scheduling.reschedule-request.v1',company_id:state.company_id,schedule_intent_id:state.schedule_intent_id,work_item_id:state.work_item_id,reason:text(reason,'reschedule-reason'),requested_window:input.requested_window??state.requested_window??null,idempotency_key:text(input.idempotency_key??`${state.idempotency_key}:reschedule`,'idempotency-key'),requires_governed_assignment:true,requires_fresh_authority_evaluation:true,automatic_assignment:false,direct_mutation:false,grants_authority:false});}

const schedulingLegacyKeys=new Set(['tenant_id','tenant_company_id','tenant','workspace_tenant_id']);
function rejectSchedulingLegacy(value,path='scheduling'){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach((item,index)=>rejectSchedulingLegacy(item,`${path}[${index}]`));return;}for(const[key,item]of Object.entries(value)){if(schedulingLegacyKeys.has(key))throw new Error(`legacy-company-boundary:${path}.${key}`);rejectSchedulingLegacy(item,`${path}.${key}`);}}
const timeMs=value=>{const parsed=Date.parse(String(value??''));return Number.isFinite(parsed)?parsed:null};
const clampWeight=value=>Math.max(0,Number(value??0)||0);

export function scoreSchedulingProposal(matchResult={},options={}){
 rejectSchedulingLegacy(options,'proposal-options');
 if(matchResult?.schema!=='titan.scheduling.match-result.v1')throw new Error('scheduling-match-result-required');
 const company_id=text(matchResult.company_id,'company-id');
 const preferred=new Set(list(options.preferred_worker_ids).map(String));
 const utilizationWeight=clampWeight(options.utilization_weight??60);
 const capacityWeight=clampWeight(options.capacity_weight??30);
 const preferenceWeight=clampWeight(options.preference_weight??10);
 const ranked_workers=list(matchResult.eligible_workers).map(worker=>{
  const capacity=Math.max(0,Number(worker?.capacity_units??0)||0);
  const available=Math.max(0,Number(worker?.available_units??0)||0);
  const utilization=Math.min(1,Math.max(0,Number(worker?.utilization??0)||0));
  const capacityRatio=capacity>0?Math.min(1,available/capacity):0;
  const score=((1-utilization)*utilizationWeight)+(capacityRatio*capacityWeight)+(preferred.has(String(worker?.worker_id))?preferenceWeight:0);
  return Object.freeze({worker_id:text(worker?.worker_id,'worker-id'),score:Number(score.toFixed(6)),utilization,available_units:available,capacity_units:capacity,preferred:preferred.has(String(worker?.worker_id)),grants_authority:false});
 }).sort((a,b)=>b.score-a.score||a.utilization-b.utilization||b.available_units-a.available_units||a.worker_id.localeCompare(b.worker_id));
 return Object.freeze({schema:'titan.scheduling.scored-proposal.v1',company_id,schedule_intent_id:text(matchResult.schedule_intent_id,'schedule-intent-id'),work_item_id:text(matchResult.work_item_id,'work-item-id'),requested_window:matchResult.requested_window??null,ranked_workers,conflict:matchResult.conflict??null,requires_governed_assignment:true,requires_fresh_authority_evaluation:true,automatic_assignment:false,direct_mutation:false,execution_permitted:false,grants_authority:false});
}

export function generateAlternativeWindows(input={},availability=[],options={}){
 rejectSchedulingLegacy(input); rejectSchedulingLegacy(availability,'availability');
 const company_id=text(input.company_id,'company-id');
 const schedule_intent_id=text(input.schedule_intent_id,'schedule-intent-id');
 const work_item_id=text(input.work_item_id,'work-item-id');
 const durationMinutes=Math.max(1,Math.floor(Number(input.duration_minutes??0)||0));
 const durationMs=durationMinutes*60000;
 const stepMinutes=Math.max(1,Math.floor(Number(options.step_minutes??30)||30));
 const stepMs=stepMinutes*60000;
 const limit=Math.min(20,Math.max(1,Math.floor(Number(options.limit??5)||5)));
 const requestedEnd=timeMs(input?.requested_window?.ends_at);
 if(requestedEnd===null)throw new Error('requested-window-required');
 const candidates=[];
 for(const row of list(availability)){
  if(row?.company_id&&String(row.company_id)!==company_id)throw new Error('cross-company-availability-denied');
  const worker_id=text(row?.worker_id,'worker-id');
  for(const window of list(row?.windows)){
   const start=timeMs(window?.starts_at),end=timeMs(window?.ends_at);
   if(start===null||end===null||end<=start)continue;
   let cursor=Math.max(start,requestedEnd);
   if(cursor>start){const offset=cursor-start;cursor=start+(Math.ceil(offset/stepMs)*stepMs);}
   for(;cursor+durationMs<=end;cursor+=stepMs){candidates.push(Object.freeze({worker_id,starts_at:new Date(cursor).toISOString(),ends_at:new Date(cursor+durationMs).toISOString(),source:'WORKER_AVAILABILITY_DERIVED',grants_authority:false}));}
  }
 }
 candidates.sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at)||a.worker_id.localeCompare(b.worker_id)||Date.parse(a.ends_at)-Date.parse(b.ends_at));
 return Object.freeze({schema:'titan.scheduling.alternative-windows.v1',company_id,schedule_intent_id,work_item_id,duration_minutes:durationMinutes,alternatives:Object.freeze(candidates.slice(0,limit)),source_semantics:'DERIVED_RECOMMENDATION_ONLY',synthetic_calendar_truth:false,requires_fresh_authority_evaluation:true,automatic_assignment:false,direct_mutation:false,execution_permitted:false,grants_authority:false});
}

export function buildGovernedRescheduleRecommendation(input={},alternative={},reason='SCHEDULING_CONFLICT'){
 rejectSchedulingLegacy(input); rejectSchedulingLegacy(alternative,'alternative');
 const company_id=text(input.company_id,'company-id');
 if(alternative?.company_id&&String(alternative.company_id)!==company_id)throw new Error('cross-company-alternative-denied');
 if(alternative?.source!=='WORKER_AVAILABILITY_DERIVED')throw new Error('derived-alternative-required');
 const starts=timeMs(alternative?.starts_at),ends=timeMs(alternative?.ends_at);
 if(starts===null||ends===null||ends<=starts)throw new Error('valid-alternative-window-required');
 return Object.freeze({schema:'titan.scheduling.reschedule-recommendation.v1',company_id,schedule_intent_id:text(input.schedule_intent_id,'schedule-intent-id'),work_item_id:text(input.work_item_id,'work-item-id'),reason:text(reason,'reschedule-reason'),recommended_worker_id:text(alternative.worker_id,'worker-id'),recommended_window:Object.freeze({starts_at:new Date(starts).toISOString(),ends_at:new Date(ends).toISOString()}),idempotency_key:text(input.idempotency_key,'idempotency-key'),source:'WORKER_AVAILABILITY_DERIVED',requires_governed_assignment:true,requires_fresh_authority_evaluation:true,automatic_assignment:false,direct_mutation:false,execution_permitted:false,grants_authority:false});
}
