import { projectDispatchSettings } from './dispatch-settings-runtime.mjs';
import { buildDispatchQueueProjection } from './dispatch-queue-runtime.mjs';
import { buildDispatchRecommendation } from './dispatch-recommendation-runtime.mjs';
import { buildDispatchActionIntent, toGovernedDispatchSubmission } from './dispatch-action-runtime.mjs';
import { buildDispatchTravelRequest, toLocalDispatchTravelEvidence } from './dispatch-travel-runtime.mjs';
import { assessDispatchRecovery } from './dispatch-recovery-runtime.mjs';
import { buildDispatchChangePropagation } from './dispatch-change-propagation-runtime.mjs';

const text=v=>String(v??'').trim();
const bool=v=>v===true;
const LEGACY=new Set(['tenant_id','tenant_company_id','tenantId','tenantCompanyId','organisation_id','organization_id']);
function rejectLegacy(v,path='$'){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}for(const[k,x]of Object.entries(v)){if(LEGACY.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(x,`${path}.${k}`);}}
function company(v){const id=text(v);if(!/^[A-Za-z0-9._:-]{2,128}$/.test(id))throw new Error('dispatch-golden-company_id-required');return id;}
function check(name,status,evidence={}){return Object.freeze({name,status,evidence:Object.freeze(evidence)});}
function finalStatus(checks){if(checks.some(x=>x.status==='BLOCKED'))return 'BLOCKED';if(checks.some(x=>x.status==='REVIEW'))return 'REVIEW_REQUIRED';return 'PASS';}

export function runDispatchGoldenEvaluation(input={}){
  rejectLegacy(input); const company_id=company(input.company_id); const checks=[];
  const policy=projectDispatchSettings({company_id,worker_id:input.worker_id,dispatchSettings:input.dispatchSettings,workforceAgentOverrides:input.workforceAgentOverrides});
  checks.push(check('settings-authority-neutral',policy.execution_permitted===false&&policy.grants_authority===false&&policy.automatic_assignment===false?'PASS':'BLOCKED',{travel_mode:policy.travel.mode}));

  const work_item=input.work_item||{}; if(work_item.company_id&&text(work_item.company_id)!==company_id)throw new Error('dispatch-golden-cross-company-work-item');
  const queue=buildDispatchQueueProjection({company_id,now_ms:Number(input.now_ms??input.now??0),work_items:[work_item],assignments:input.assignments||[]});
  const recommendation=buildDispatchRecommendation({company_id,work_item,queue,worker_availability:input.worker_availability||[],worker_locations:input.worker_locations||[]},input.graph||{},input.capacity_snapshot||null);
  checks.push(check('recommendation-proposal-only',recommendation.execution_permitted===false&&recommendation.automatic_assignment===false?'PASS':'BLOCKED',{state:recommendation.state,selected_worker_id:recommendation.selected_candidate?.worker_id||null}));

  let action_intent=null,governed_submission=null;
  if(recommendation.state==='RECOMMENDED'&&recommendation.selected_candidate?.worker_id){
    try{
      action_intent=buildDispatchActionIntent({company_id,action:input.action||'ASSIGN',work_item,target_worker_id:recommendation.selected_candidate.worker_id,recommendation,assignments:input.assignments||[],confirmed:bool(input.confirmed),confirmation_refs:input.confirmation_refs||[]});
      checks.push(check('manual-confirmation-gate',action_intent.state==='READY_FOR_GOVERNED_SUBMISSION'?'PASS':'REVIEW',{state:action_intent.state}));
      if(action_intent.state==='READY_FOR_GOVERNED_SUBMISSION'&&input.actor_id&&input.authority_context){
        governed_submission=toGovernedDispatchSubmission(action_intent,{actor_id:input.actor_id,authority_context:input.authority_context,operation_id:input.operation_id,idempotency_key:input.idempotency_key,evidence_refs:input.evidence_refs});
        checks.push(check('governed-submission-boundary',governed_submission.direct_mutation===false&&governed_submission.execution_permitted===false&&governed_submission.requires_fresh_authority_evaluation===true?'PASS':'BLOCKED',{capability:governed_submission.capability}));
      }
    }catch(error){checks.push(check('manual-action-validity','BLOCKED',{error:String(error?.message||error)}));}
  } else checks.push(check('manual-confirmation-gate','REVIEW',{reason:'no-recommended-worker'}));

  let travel=null;
  try{
    travel=buildDispatchTravelRequest({company_id,work_item,work_item_id:work_item.work_item_id,origin:input.origin||{},destination:input.destination||work_item,provider_mode:policy.travel.mode,allow_external_provider:policy.travel.external_provider_enabled,providers:input.providers||[],provider_id:input.provider_id,cost_acknowledged:input.cost_acknowledged});
    if(travel.provider_mode==='LOCAL_GEOMETRY') travel=toLocalDispatchTravelEvidence(travel);
    checks.push(check('travel-cost-sovereignty',travel.billable_to_titan===false&&travel.execution_permitted===false&&travel.travel_time_inferred===false?'PASS':'BLOCKED',{provider_mode:travel.provider_mode,duration_ms:travel.duration_ms??null}));
  }catch(error){checks.push(check('travel-cost-sovereignty','REVIEW',{error:String(error?.message||error)}));}

  const recovery=assessDispatchRecovery({company_id,events:input.events||[],canonical_job_revision:input.canonical_job_revision,recovery_entries:input.recovery_entries||[],pending_operations:input.pending_operations||[],dependencies:input.dependencies||[],circuits:input.circuits||[],now:Number(input.now??Date.now())});
  checks.push(check('restart-replay-safety',recovery.auto_replay===false&&recovery.automatic_job_state_repair===false&&recovery.execution_permitted===false?(recovery.state==='CLEAR'?'PASS':'REVIEW'):'BLOCKED',{state:recovery.state,duplicates:recovery.duplicate_event_ids.length,stale:recovery.stale_event_ids.length}));

  let propagation=null;
  if(input.change_event||input.change_kind){
    const accepted=recovery.state==='CLEAR'&&recovery.duplicate_event_ids.length===0&&recovery.stale_event_ids.length===0&&recovery.future_revision_event_ids.length===0&&recovery.conflicting_event_ids.length===0;
    if(accepted&&policy.same_day_changes.enabled){
      propagation=buildDispatchChangePropagation({company_id,work_item,assignment:input.assignment,customer:input.customer,change_event:input.change_event,change_kind:input.change_kind,change_at:input.change_at||input.now,service_at:input.service_at,worker_refs:input.worker_refs,customer_refs:policy.same_day_changes.customer_projection_enabled?(input.customer_refs||input.customer?.customer_id):[],same_day_only:true,timezone_offset_minutes:input.timezone_offset_minutes});
      checks.push(check('same-day-projection-no-send',propagation.automatic_send===false&&propagation.execution_permitted===false&&propagation.grants_authority===false?'PASS':'BLOCKED',{state:propagation.state,customer_projected:Boolean(propagation.customer_projection)}));
    }else checks.push(check('same-day-projection-no-send','REVIEW',{suppressed_by:accepted?'settings':'recovery-evidence'}));
  }

  const status=finalStatus(checks);
  return Object.freeze({schema:'titan.workforce.dispatch.golden-evaluation.v1',company_id,status,checks:Object.freeze(checks),policy,recommendation,action_intent,governed_submission,travel,recovery,propagation,canonical_jobs_owned_elsewhere:true,canonical_scheduling_owned_elsewhere:true,manual_confirmation_required:true,automatic_assignment:false,automatic_reassignment:false,automatic_customer_contact:false,auto_replay:false,direct_mutation:false,execution_permitted:false,identity_confers_authority:false,grants_authority:false});
}
export function summarizeDispatchGoldenEvaluation(v={}){return Object.freeze({company_id:v.company_id||null,status:v.status||null,checks:Array.isArray(v.checks)?v.checks.map(x=>({name:x.name,status:x.status})):[],automatic_assignment:false,automatic_reassignment:false,automatic_customer_contact:false,auto_replay:false,execution_permitted:false,grants_authority:false});}
