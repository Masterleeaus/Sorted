const clean=(v,max=240)=>String(v??'').trim().slice(0,max);
const list=v=>Array.isArray(v)?v:[];
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const ACTIVE_ASSIGNMENT_STATES=new Set(['proposed','assigned','dispatched','en_route','arrived','in_progress']);
const TERMINAL_WORK_STATES=new Set(['completed','cancelled','canceled','rejected','expired']);
const ACTIONS=Object.freeze({
  ASSIGN:{key:'workcore.dispatch.assign',permission:'business.dispatch.assign'},
  REASSIGN:{key:'workcore.dispatch.reassign',permission:'business.dispatch.reassign'}
});
function assertCompany(company_id){if(!validCompany(company_id))throw new Error('dispatch-action-company_id-required');}
function companyRow(row,company_id,label){if(row?.company_id&&clean(row.company_id,128)!==company_id)throw new Error(`dispatch-action-cross-company-${label}-rejected`);return row||{};}
function assignmentFor(rows,company_id,work_item_id){
  const safe=list(rows).map(x=>companyRow(x,company_id,'assignment'));
  return safe.find(x=>clean(x.work_item_id||x.job_id||x.work_order_id)===work_item_id&&ACTIVE_ASSIGNMENT_STATES.has(clean(x.state||x.status,60).toLowerCase()))||null;
}
function selectedWorker(recommendation={}){return clean(recommendation?.selected_candidate?.worker_id);}
function normalizeAction(v){const x=clean(v,40).toUpperCase();if(!ACTIONS[x])throw new Error('dispatch-action-invalid-action');return x;}
function confirmationRefs(input={}){return [...new Set(list(input.confirmation_refs||input.approval_refs).map(x=>clean(x)).filter(Boolean))].sort();}
function stableId(company_id,action,work_item_id,target_worker_id,assignment_id){return `dispatch-action:${company_id}:${action.toLowerCase()}:${work_item_id}:${assignment_id||'new'}:${target_worker_id}`;}
export function buildDispatchActionIntent(input={}){
  const company_id=clean(input.company_id,128);assertCompany(company_id);
  const action=normalizeAction(input.action);
  const work_item=companyRow(input.work_item||{},company_id,'work-item');
  const work_item_id=clean(input.work_item_id||work_item.work_item_id||work_item.job_id||work_item.work_order_id);
  if(!work_item_id)throw new Error('dispatch-action-work_item_id-required');
  if(TERMINAL_WORK_STATES.has(clean(work_item.state||work_item.status,60).toLowerCase()))throw new Error('dispatch-action-terminal-work-item-rejected');
  const recommendation=input.recommendation||null;
  if(recommendation){
    if(recommendation.schema!=='titan.workforce.dispatch.recommendation.v1')throw new Error('dispatch-action-recommendation-invalid');
    if(clean(recommendation.company_id,128)!==company_id)throw new Error('dispatch-action-cross-company-recommendation-rejected');
    if(clean(recommendation.work_item_id)!==work_item_id)throw new Error('dispatch-action-recommendation-work-item-mismatch');
    if(recommendation.state!=='RECOMMENDED')throw new Error('dispatch-action-recommendation-not-ready');
  }
  const existing=input.assignment?companyRow(input.assignment,company_id,'assignment'):assignmentFor(input.assignments,company_id,work_item_id);
  const target_worker_id=clean(input.target_worker_id||selectedWorker(recommendation));
  if(!target_worker_id)throw new Error('dispatch-action-target_worker_id-required');
  const current_worker_id=clean(existing?.worker_id||existing?.worker_user_id)||null;
  const assignment_id=clean(input.assignment_id||existing?.assignment_id||existing?.public_id||existing?.id)||null;
  if(action==='ASSIGN'&&existing)throw new Error('dispatch-action-existing-assignment-requires-reassign');
  if(action==='REASSIGN'&&!existing)throw new Error('dispatch-action-reassignment-existing-assignment-required');
  if(action==='REASSIGN'&&!assignment_id)throw new Error('dispatch-action-reassignment-assignment_id-required');
  if(action==='REASSIGN'&&current_worker_id===target_worker_id)throw new Error('dispatch-action-reassignment-target-unchanged');
  if(recommendation&&selectedWorker(recommendation)!==target_worker_id)throw new Error('dispatch-action-target-not-selected-recommendation');
  const refs=confirmationRefs(input);const confirmed=input.confirmed===true&&refs.length>0;
  const state=confirmed?'READY_FOR_GOVERNED_SUBMISSION':'AWAITING_CONFIRMATION';
  const def=ACTIONS[action];
  return {
    schema:'titan.workforce.dispatch.action-intent.v1',dispatch_action_intent_id:stableId(company_id,action,work_item_id,target_worker_id,assignment_id),company_id,action,work_item_id,assignment_id,current_worker_id,target_worker_id,state,
    workcore_action_key:def.key,required_permission:def.permission,risk:'medium',requires_confirmation:true,confirmation_refs:refs,requires_fresh_authority_evaluation:true,requires_online_governed_dispatch:true,
    source_dispatch_recommendation_id:recommendation?.dispatch_recommendation_id||null,
    expected_effect:{domain:'dispatch',action:action.toLowerCase(),work_item_id,assignment_id,current_worker_id,target_worker_id},
    reversibility:action==='ASSIGN'?'reassign_or_status_change':'reassign_again',compensation_capability:'workcore.dispatch.reassign',
    direct_mutation:false,execution_permitted:false,automatic_assignment:false,automatic_reassignment:false,identity_confers_authority:false,role_confers_authority:false,grants_authority:false,authority_effect:false
  };
}
export function toGovernedDispatchSubmission(intent={},input={}){
  if(intent?.schema!=='titan.workforce.dispatch.action-intent.v1')throw new Error('dispatch-action-intent-required');
  if(intent.state!=='READY_FOR_GOVERNED_SUBMISSION')throw new Error('dispatch-action-confirmation-required');
  const actor_id=clean(input.actor_id);if(!actor_id)throw new Error('dispatch-action-actor_id-required');
  const authority_context=input.authority_context;
  if(!authority_context||typeof authority_context!=='object'||Array.isArray(authority_context))throw new Error('dispatch-action-authority-context-required');
  if(authority_context.company_id&&clean(authority_context.company_id,128)!==intent.company_id)throw new Error('dispatch-action-cross-company-authority-context-rejected');
  const workerId=clean(authority_context.worker?.worker_id||authority_context.worker?.actor_id||actor_id);
  if(workerId!==actor_id)throw new Error('dispatch-action-authority-actor-mismatch');
  const operation_id=clean(input.operation_id)||intent.dispatch_action_intent_id;
  const idempotency_key=clean(input.idempotency_key)||`dispatch:${intent.company_id}:${intent.action.toLowerCase()}:${intent.work_item_id}:${intent.assignment_id||'new'}:${intent.target_worker_id}`;
  const payload=intent.action==='ASSIGN'?{work_item_id:intent.work_item_id,worker_id:intent.target_worker_id}:{assignment_id:intent.assignment_id,work_item_id:intent.work_item_id,worker_id:intent.target_worker_id,previous_worker_id:intent.current_worker_id};
  return {
    schema:'titan.workforce.dispatch.governed-submission.v1',company_id:intent.company_id,actor_id,action_id:intent.dispatch_action_intent_id,capability:intent.workcore_action_key,workcore_action_key:intent.workcore_action_key,required_permission:intent.required_permission,operation_id,idempotency_key,payload,
    proposal_lifecycle:{company_id:intent.company_id,intent_id:intent.dispatch_action_intent_id,operation_id,idempotency_key,state:'approved',approval_refs:[...intent.confirmation_refs],evidence_refs:list(input.evidence_refs).map(x=>clean(x)).filter(Boolean),risk:'medium',expected_effect:intent.expected_effect,reversibility:intent.reversibility,compensation_capability:intent.compensation_capability,grants_authority:false},
    authority_context:{...authority_context,company_id:intent.company_id,operation_id,action_id:intent.dispatch_action_intent_id,capability:intent.workcore_action_key,risk:'medium',requirement:{...(authority_context.requirement||{}),company_id:intent.company_id,capability:intent.workcore_action_key,effect:'write',required_permissions:[intent.required_permission],approval_policy:'explicit_confirmation',reversibility:intent.reversibility,identity_confers_authority:false},approval:authority_context.approval||{company_id:intent.company_id,status:'approved',approval_scope:intent.dispatch_action_intent_id},identity_confers_authority:false,role_confers_authority:false,grants_authority:false},
    execution_transport:'titan-workforce-gateway-to-workcore-business-action-dispatcher',requires_fresh_authority_evaluation:true,requires_authoritative_receipt:true,direct_mutation:false,execution_permitted:false,grants_authority:false,authority_effect:false
  };
}
export function summarizeDispatchActionIntent(i={}){return {company_id:i.company_id,action:i.action,work_item_id:i.work_item_id,assignment_id:i.assignment_id||null,current_worker_id:i.current_worker_id||null,target_worker_id:i.target_worker_id||null,state:i.state,workcore_action_key:i.workcore_action_key,requires_confirmation:true,requires_fresh_authority_evaluation:true,direct_mutation:false,execution_permitted:false,grants_authority:false};}
