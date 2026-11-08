const LEGACY_KEYS=new Set(['tenant_id','tenantId','tenant_company_id','tenantCompanyId','workspace_tenant_id']);
const AUTHORITY_DECISIONS=new Set(['ALLOW','APPROVAL_REQUIRED','EVIDENCE_REQUIRED','ESCALATE','DENY','AUTHORITY_UNAVAILABLE','RECOVERY_REQUIRED']);
const RISK_LEVELS=new Set(['none','low','medium','high','critical']);
const text=(v,n)=>{const s=String(v??'').trim();if(!s&&n)throw new Error(`${n}-required`);return s||null};
const list=v=>Array.isArray(v)?v:[];
function rejectLegacy(value,path='scheduling-approval'){
 if(!value||typeof value!=='object')return;
 if(Array.isArray(value)){value.forEach((v,i)=>rejectLegacy(v,`${path}[${i}]`));return;}
 for(const[k,v]of Object.entries(value)){if(LEGACY_KEYS.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(v,`${path}.${k}`);}
}
function freezeReasons(values){return Object.freeze([...new Set(values.map(v=>String(v??'').trim()).filter(Boolean))].sort());}
function authorityStatus(decision){
 switch(decision){
  case 'ALLOW':return ['READY_FOR_GOVERNED_SUBMISSION','decision_feed'];
  case 'APPROVAL_REQUIRED':return ['APPROVAL_REQUIRED','approval_queue'];
  case 'EVIDENCE_REQUIRED':return ['EVIDENCE_REQUIRED','human_review'];
  case 'ESCALATE':return ['ESCALATION_REQUIRED','human_review'];
  case 'DENY':return ['DENIED','human_review'];
  case 'AUTHORITY_UNAVAILABLE':return ['AUTHORITY_UNAVAILABLE','human_review'];
  case 'RECOVERY_REQUIRED':return ['RECOVERY_REQUIRED','human_review'];
  default:return ['AUTHORITY_EVALUATION_REQUIRED','approval_queue'];
 }
}

/**
 * Converts a Scheduling recommendation and (optionally) the canonical authority evaluator result into
 * a human-decision packet. This is a projection/hand-off only: even ALLOW never executes work here.
 */
export function buildSchedulingApprovalEscalation(input={},recommendation={},authorityDecision=null){
 rejectLegacy(input);rejectLegacy(recommendation,'recommendation');if(authorityDecision)rejectLegacy(authorityDecision,'authority-decision');
 const company_id=text(input.company_id,'company-id');
 if(recommendation?.schema!=='titan.scheduling.cleaning-recommendation.v1')throw new Error('cleaning-scheduling-recommendation-required');
 if(String(recommendation.company_id??'')!==company_id)throw new Error('cross-company-recommendation-denied');
 const operation_id=text(input.operation_id,'operation-id'),action_id=text(input.action_id,'action-id');
 const risk_level=String(input.risk_level??'none').trim().toLowerCase();if(!RISK_LEVELS.has(risk_level))throw new Error(`invalid-risk:${risk_level}`);
 if(authorityDecision){
  if(String(authorityDecision.company_id??'')!==company_id)throw new Error('cross-company-authority-decision-denied');
  if(authorityDecision.operation_id&&String(authorityDecision.operation_id)!==operation_id)throw new Error('authority-operation-mismatch');
  if(authorityDecision.action_id&&String(authorityDecision.action_id)!==action_id)throw new Error('authority-action-mismatch');
  if(!AUTHORITY_DECISIONS.has(String(authorityDecision.decision??'')))throw new Error('canonical-authority-decision-invalid');
 }
 const requirementsUnmet=recommendation.status==='REQUIREMENTS_UNMET'||list(recommendation.unmet_requirements).length>0;
 const authoritySensitive=input.reassignment===true||input.customer_visible_change===true||input.override_requested===true||['high','critical'].includes(risk_level);
 const approval_required=authoritySensitive||risk_level==='medium';
 let status,target_surface,reason_codes=[];
 if(requirementsUnmet){status='REQUIREMENTS_REVIEW_REQUIRED';target_surface='human_review';reason_codes.push('cleaning_requirements_unmet');}
 else if(!authorityDecision){status='AUTHORITY_EVALUATION_REQUIRED';target_surface=approval_required?'approval_queue':'decision_feed';reason_codes.push('fresh_authority_evaluation_required');}
 else {
  [status,target_surface]=authorityStatus(String(authorityDecision.decision));
  reason_codes.push(...list(authorityDecision.reason_codes));
 }
 const approval_satisfied=Boolean(authorityDecision&&authorityDecision.decision==='ALLOW');
 const human_attention_required=target_surface!=='decision_feed'||approval_required||requirementsUnmet;
 return Object.freeze({
  schema:'titan.scheduling.approval-escalation.v1',company_id,schedule_intent_id:text(recommendation.schedule_intent_id,'schedule-intent-id'),work_item_id:text(recommendation.work_item_id,'work-item-id'),operation_id,action_id,risk_level,reassignment:input.reassignment===true,customer_visible_change:input.customer_visible_change===true,override_requested:input.override_requested===true,reason:text(input.reason)||null,status,target_surface,human_attention_required,approval_required,approval_satisfied,authority_evaluation_satisfied:Boolean(authorityDecision&&authorityDecision.decision==='ALLOW'),authority_decision_id:text(authorityDecision?.authority_decision_id)||null,authority_decision:authorityDecision?String(authorityDecision.decision):null,authority_requirement:Object.freeze({company_id,capability:'schedule.assignment',operation:input.reassignment===true?'reassign':'assign',requirement_level:approval_required?'approval':'governed',authority_required:true,approval_required,reason_codes:freezeReasons(reason_codes)}),reason_codes:freezeReasons(reason_codes),recommendation_status:recommendation.status,unmet_requirements:Object.freeze(list(recommendation.unmet_requirements)),requires_canonical_authority_evaluator:true,requires_command_bus:true,projection_only:true,automatic_assignment:false,automatic_reschedule:false,direct_mutation:false,execution_permitted:false,authority_granted:false,grants_authority:false,identity_not_authority:true
 });
}
