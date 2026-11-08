// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/scheduling/assignment-offline-restart-runtime.mjs
const SCHEMA = 'titan.workforce.assignment-offline-restart.v1';
const ENVELOPE_SCHEMA = 'titan.workforce.assignment-offline-envelope.v1';
const FORBIDDEN = new Set(['tenant_id','tenant_company_id','workspace_tenant_id']);
const clean = (v, max=240) => String(v ?? '').trim().slice(0,max);
const list = v => Array.isArray(v) ? v : [];
const clone = v => v == null ? v : globalThis.structuredClone ? structuredClone(v) : JSON.parse(JSON.stringify(v));
function rejectLegacy(value,path='input'){
  if(!value||typeof value!=='object') return;
  if(Array.isArray(value)){value.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}
  for(const [k,v] of Object.entries(value)){if(FORBIDDEN.has(k)) throw new Error(`${path}-legacy-tenant-boundary-rejected:${k}`);rejectLegacy(v,`${path}.${k}`);}
}
function company(value,label='input'){
  const out=clean(value,128); if(!/^[A-Za-z0-9._:-]{2,128}$/.test(out)) throw new Error(`${label}-company_id-required`); return out;
}
function assertCompany(value,company_id,label){
  rejectLegacy(value,label); if(value?.company_id && clean(value.company_id,128)!==company_id) throw new Error(`${label}-cross-company-rejected`);
}
function required(value,label){const out=clean(value);if(!out)throw new Error(`${label}-required`);return out;}
function integer(value,label,{min=0}={}){const n=Number(value);if(!Number.isInteger(n)||n<min)throw new Error(`${label}-invalid`);return n;}
function stableKey(parts){return parts.map(v=>clean(v,300)).join(':');}
function normalizeDecision(raw, company_id){
  assertCompany(raw,company_id,'assignment-decision');
  const assignment_id=required(raw?.assignment_id,'assignment_id');
  const work_item_id=required(raw?.work_item_id,'work_item_id');
  const worker_id=required(raw?.worker_id,'worker_id');
  const state=required(raw?.decision_state,'decision_state').toLowerCase();
  if(!['proposed','assigned','rejected','expired'].includes(state)) throw new Error('assignment-decision-state-invalid');
  if(raw?.grants_authority===true) throw new Error('assignment-decision-authority-escalation-rejected');
  const revision=raw?.revision==null?null:integer(raw.revision,'assignment-revision',{min:0});
  return {company_id,assignment_id,work_item_id,worker_id,decision_state:state,revision};
}
function normalizeAcceptance(raw, decision, company_id){
  if(!raw) return null;
  assertCompany(raw,company_id,'acceptance-receipt');
  const assignment_id=required(raw.assignment_id,'acceptance-assignment_id');
  if(assignment_id!==decision.assignment_id) throw new Error('acceptance-assignment-mismatch');
  const acceptance_id=required(raw.acceptance_id,'acceptance_id');
  const authority_decision_ref=required(raw.authority_decision_ref,'acceptance-authority_decision_ref');
  const accepted_at=required(raw.accepted_at,'acceptance-accepted_at');
  if(!Number.isFinite(Date.parse(accepted_at))) throw new Error('acceptance-accepted_at-invalid');
  const revision=integer(raw.revision,'acceptance-revision',{min:0});
  if(decision.revision!=null && revision!==decision.revision) throw new Error('acceptance-revision-mismatch');
  const idempotency_key=clean(raw.idempotency_key)||stableKey(['assignment-accept',company_id,assignment_id,acceptance_id,revision]);
  return {company_id,assignment_id,acceptance_id,authority_decision_ref,accepted_at,revision,idempotency_key};
}
export function buildAssignmentOfflineEnvelope(input={}){
  rejectLegacy(input,'input');
  const company_id=company(input.company_id);
  const decision=normalizeDecision(input.assignment_decision,company_id);
  const operation_id=clean(input.operation_id)||stableKey(['assignment-recovery',company_id,decision.assignment_id]);
  const acceptance=normalizeAcceptance(input.acceptance_receipt,decision,company_id);
  if(decision.decision_state==='assigned' && !acceptance) throw new Error('accepted-assignment-receipt-required');
  if(decision.decision_state!=='assigned' && acceptance) throw new Error('acceptance-receipt-requires-assigned-state');
  const idempotency_key=acceptance?.idempotency_key || stableKey(['assignment-proposal',company_id,decision.assignment_id,decision.revision??'unversioned']);
  return Object.freeze({
    schema:ENVELOPE_SCHEMA,company_id,operation_id,idempotency_key,
    assignment_decision:clone(input.assignment_decision),acceptance_receipt:acceptance?clone(acceptance):null,
    persisted_state:decision.decision_state==='assigned'?'ACCEPTED_EVIDENCE_PERSISTED':'PROPOSAL_EVIDENCE_PERSISTED',
    requires_explicit_resume:true,requires_fresh_scheduling_evidence:true,requires_fresh_authority_for_effects:true,
    automatic_effect_replay:false,effect_replay_allowed:false,automatic_assignment:false,automatic_reassignment:false,
    authority_neutral:true,grants_authority:false
  });
}
export function reconcileAssignmentRestart(input={}){
  rejectLegacy(input,'input');
  const company_id=company(input.company_id);
  const envelope=input.envelope;
  assertCompany(envelope,company_id,'offline-envelope');
  if(envelope?.schema!==ENVELOPE_SCHEMA) throw new Error('assignment-offline-envelope-required');
  const decision=normalizeDecision(envelope.assignment_decision,company_id);
  const acceptance=normalizeAcceptance(envelope.acceptance_receipt,decision,company_id);
  const priorKeys=new Set(list(input.applied_idempotency_keys).map(v=>clean(v)).filter(Boolean));
  const currentRevision=input.current_assignment_revision==null?null:integer(input.current_assignment_revision,'current-assignment-revision',{min:0});
  const currentState=clean(input.current_assignment_state).toLowerCase()||null;
  let state; const blockers=[]; const review_reasons=[]; let duplicate=false;

  if(decision.decision_state==='proposed'){
    state='RECOVERED_PROPOSAL_REVIEW_REQUIRED';
    review_reasons.push('FRESH_AVAILABILITY_CAPACITY_MATCH_CONFLICT_REVALIDATION_REQUIRED','FRESH_ASSIGNMENT_AUTHORITY_REQUIRED');
    if(currentState==='assigned') blockers.push('CURRENT_ASSIGNMENT_ALREADY_ASSIGNED');
  } else if(decision.decision_state==='assigned'){
    if(!acceptance){state='BLOCKED_ACCEPTANCE_EVIDENCE_MISSING';blockers.push('ACCEPTANCE_RECEIPT_REQUIRED');}
    else {
      duplicate=priorKeys.has(acceptance.idempotency_key);
      if(currentRevision!=null && currentRevision>acceptance.revision){state='BLOCKED_STALE_ACCEPTED_REVISION';blockers.push('NEWER_ASSIGNMENT_REVISION_EXISTS');}
      else if(currentRevision!=null && currentRevision<acceptance.revision){state='REVIEW_ACCEPTED_REVISION_AHEAD';review_reasons.push('AUTHORITATIVE_ASSIGNMENT_STORE_RECONCILIATION_REQUIRED');}
      else if(currentState && currentState!=='assigned'){state='REVIEW_ACCEPTED_STATE_DIVERGENCE';review_reasons.push('AUTHORITATIVE_ASSIGNMENT_STATE_RECONCILIATION_REQUIRED');}
      else if(duplicate){state='ACCEPTED_ASSIGNMENT_ALREADY_APPLIED';}
      else {state='ACCEPTED_ASSIGNMENT_EVIDENCE_RECOVERED';review_reasons.push('NO_EFFECT_REPLAY_CONFIRM_AUTHORITATIVE_STORE');}
    }
  } else {
    state='TERMINAL_ASSIGNMENT_DECISION_RECOVERED';
  }

  return Object.freeze({
    schema:SCHEMA,company_id,operation_id:required(envelope.operation_id,'operation_id'),assignment_id:decision.assignment_id,
    decision_state:decision.decision_state,recovered_state:state,duplicate_idempotency_key:duplicate,
    acceptance_receipt_ref:acceptance?.acceptance_id??null,acceptance_authority_decision_ref:acceptance?.authority_decision_ref??null,
    idempotency_key:required(envelope.idempotency_key,'idempotency_key'),blockers:[...new Set(blockers)].sort(),review_reasons:[...new Set(review_reasons)].sort(),
    replay_outcome: blockers.length?'BLOCKED':review_reasons.length?'REVIEW_REQUIRED':duplicate?'NOOP_ALREADY_APPLIED':'EVIDENCE_ONLY',
    accepted_state_manufactured:false,proposal_promoted_to_assigned:false,duplicate_effect_prevented:true,
    requires_explicit_resume:true,requires_fresh_scheduling_evidence:decision.decision_state==='proposed',requires_fresh_authority_for_effects:true,
    automatic_effect_replay:false,effect_replay_allowed:false,automatic_assignment:false,automatic_reassignment:false,
    execution_permitted:false,authority_neutral:true,grants_authority:false
  });
}
export function summarizeAssignmentRestart(result={}){
  return Object.freeze({schema:'titan.workforce.assignment-offline-restart-summary.v1',company_id:result.company_id??null,assignment_id:result.assignment_id??null,recovered_state:result.recovered_state??null,replay_outcome:result.replay_outcome??null,blocker_count:list(result.blockers).length,review_count:list(result.review_reasons).length,grants_authority:false});
}
export {SCHEMA as ASSIGNMENT_OFFLINE_RESTART_SCHEMA, ENVELOPE_SCHEMA as ASSIGNMENT_OFFLINE_ENVELOPE_SCHEMA};
