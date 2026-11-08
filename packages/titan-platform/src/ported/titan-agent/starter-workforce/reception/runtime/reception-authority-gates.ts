// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-agent/starter-workforce/reception/runtime/reception-authority-gates.mjs
import { createAuthorityRequirement, createApprovalState } from '../../../../titan-runtime/authority/worker-authority.js';

const LEGACY=new Set(['tenant_id','tenant_company_id','tenant_company','tenant','tenantCompanyId','organisation_id','organization_id','workspace_tenant_id']);
const CATEGORIES=Object.freeze(['information','pricing','commitment','complaint','emergency','cross_agent_action','regulated_claim','unknown']);
const clean=(v,max=240)=>typeof v==='string'?v.trim().replace(/\s+/g,' ').slice(0,max):'';
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const arr=v=>Array.isArray(v)?v:[];
const unique=(v,max=20,len=120)=>Object.freeze([...new Set(arr(v).map(x=>clean(x,len)).filter(Boolean))].slice(0,max));
function rejectLegacy(v,path='reception-authority'){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}for(const[k,x]of Object.entries(v)){if(LEGACY.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(x,`${path}.${k}`);}}
function company(v){const id=clean(v,128);if(!id)throw new TypeError('company_id is required');return id;}
function category(v){const c=clean(v,80).toLowerCase();return CATEGORIES.includes(c)?c:'unknown';}
function riskRank(r){return ({none:0,low:1,medium:2,high:3,critical:4})[r]??4;}
function maxRisk(a,b){return riskRank(a)>=riskRank(b)?a:b;}

export function classifyReceptionAuthorityRisk(input={}){
  rejectLegacy(input);const company_id=company(input.company_id);const kind=category(input.category||input.kind);
  const dynamic=input.dynamic===true;const mutation=input.mutation===true;const promise=input.promise===true;const verified=input.authoritative_source===true;
  let risk='low',review='not_required',decision='allow_information_only',reason='bounded_information';
  if(kind==='unknown'){risk='medium';review='required';decision='escalate';reason='unknown_or_unclassified_claim';}
  if(kind==='pricing'){
    if(dynamic||mutation||promise||!verified){risk='high';review='required';decision='hold_for_review';reason='pricing_or_quote_commitment';}
    else {risk='low';decision='allow_information_only';reason='approved_static_price_information';}
  }
  if(kind==='commitment'){risk='high';review='required';decision='hold_for_review';reason='customer_commitment_requires_governed_authority';}
  if(kind==='complaint'){risk='medium';review='required';decision='escalate';reason='complaint_requires_human_review';}
  if(kind==='emergency'){risk='critical';review='required';decision='escalate_immediately';reason='emergency_or_safety_event';}
  if(kind==='cross_agent_action'){risk=mutation?'high':'medium';review='required';decision='hold_for_governed_handoff';reason='cross_agent_action_requires_governed_handoff';}
  if(kind==='regulated_claim'){risk='high';review='required';decision='escalate';reason='regulated_or_high_consequence_claim';}
  if(input.safety_concern===true){risk=maxRisk(risk,'critical');review='required';decision='escalate_immediately';reason='safety_concern';}
  return Object.freeze({schema:'titan.zero.reception.authority-risk/v1',company_id,category:kind,risk,review_status:review,decision,reason,
    informational_only:!mutation,mutation_requested:mutation,authoritative_source_verified:verified,
    emergency_escalation_required:risk==='critical',identity_confers_authority:false,authority_granted:false,execution_permitted:false,grants_authority:false});
}

export function buildReceptionApprovalRequirement(riskInput={},context={}){
  const risk=classifyReceptionAuthorityRisk(riskInput);const company_id=risk.company_id;if(context.company_id&&company(context.company_id)!==company_id)throw new Error('reception-authority-cross-company-context');
  const capability=clean(context.capability,120)||({pricing:'reception.request_quote_review',commitment:'reception.request_commitment_review',complaint:'reception.request_human_review',emergency:'reception.request_emergency_escalation',cross_agent_action:'reception.request_handoff',regulated_claim:'reception.request_human_review'}[risk.category]||'reception.lookup_business_knowledge');
  const protectedAction=risk.review_status==='required'||risk.mutation_requested;
  const authority_requirement=createAuthorityRequirement({company_id,capability,effect:protectedAction?'submit':'read',action_class:`reception.${risk.category}`,target:clean(context.target,100)||null,
    protected_action:protectedAction,required_permissions:unique(context.required_permissions),required_entitlements:unique(context.required_entitlements),required_evidence:unique(context.required_evidence),
    approval_policy:risk.review_status==='required'?'reception_reviewer_required':null,reversibility:risk.risk==='critical'?'unknown':'reversible'});
  const approval=createApprovalState({company_id,status:risk.review_status==='required'?'required':'not_required',approval_scope:risk.review_status==='required'?`reception:${risk.category}`:null});
  return Object.freeze({schema:'titan.zero.reception.approval-gate/v1',company_id,risk,authority_requirement,approval,
    must_use_existing_authority_evaluator:true,must_use_existing_execution_boundary:true,may_prepare_execution:false,authority_granted:false,execution_permitted:false});
}

export function evaluateReceptionReviewGate(input={}){
  rejectLegacy(input);const company_id=company(input.company_id);const gate=buildReceptionApprovalRequirement({...obj(input.risk),company_id},obj(input.context));
  const approval=obj(input.approval);if(approval.company_id&&company(approval.company_id)!==company_id)throw new Error('reception-authority-cross-company-approval');
  const status=clean(approval.status,40)||gate.approval.status;
  const allowedStatuses=new Set(['not_required','required','pending','approved','denied','expired','revoked']);if(!allowedStatuses.has(status))throw new Error(`invalid-approval-status:${status}`);
  const reviewerSatisfied=gate.risk.review_status!=='required'||status==='approved';
  const blocked=status==='denied'||status==='expired'||status==='revoked'||gate.risk.risk==='critical';
  const eligible_for_authority_evaluation=reviewerSatisfied&&!blocked&&gate.risk.decision!=='escalate'&&gate.risk.decision!=='escalate_immediately';
  return Object.freeze({schema:'titan.zero.reception.review-evaluation/v1',company_id,category:gate.risk.category,risk:gate.risk.risk,approval_status:status,
    reviewer_satisfied:reviewerSatisfied,blocked,eligible_for_authority_evaluation,requires_human_escalation:gate.risk.decision.startsWith('escalate'),
    requires_governed_handoff:gate.risk.category==='cross_agent_action',next_boundary:eligible_for_authority_evaluation?'titan-runtime/authority/authority-evaluator.js':'human_or_escalation',
    approval_is_not_execution_authority:true,authority_granted:false,execution_permitted:false,grants_authority:false});
}

export function buildReceptionGovernedActionRequest(input={}){
  rejectLegacy(input);const company_id=company(input.company_id);const evaluation=evaluateReceptionReviewGate({company_id,risk:input.risk,context:input.context,approval:input.approval});
  const interaction_id=clean(input.interaction_id,160);const action=clean(input.action,120);if(!interaction_id)throw new Error('interaction_id is required');if(!action)throw new Error('action is required');
  const target_agent=clean(input.target_agent,80)||null;
  if(evaluation.requires_governed_handoff&&!target_agent)throw new Error('target_agent is required for cross-agent action');
  return Object.freeze({schema:'titan.zero.reception.governed-action-request/v1',company_id,worker_id:'titan.customer.receptionist',interaction_id,action,target_agent,
    operation_id:`reception:${interaction_id}:${action}`,idempotency_key:`reception:${interaction_id}:${action}:${target_agent||'self'}`,
    review:evaluation,payload:Object.freeze({...obj(input.payload),company_id}),
    submit_only_if_authority_evaluator_allows:true,submit_via_existing_execution_boundary:true,requires_authoritative_receipt_for_success_claim:true,
    identity_confers_authority:false,authority_granted:false,execution_permitted:false,grants_authority:false});
}

export const RECEPTION_AUTHORITY_CATEGORIES=CATEGORIES;
