// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/jobs/jobs-lifecycle-contract.mjs
const LEGACY_TENANT_KEYS = ['tenant_id','tenantId','tenant_company_id'];
export const JOB_STATES = Object.freeze(['planned','assigned','en_route','started','blocked','completed','qa_ready','closed']);
export const JOB_TRANSITIONS = Object.freeze({
  planned:['assigned'],
  assigned:['en_route','planned','blocked'],
  en_route:['started','assigned','blocked'],
  started:['blocked','completed'],
  blocked:['started','assigned'],
  completed:['qa_ready','started'],
  qa_ready:['closed','started'],
  closed:[]
});
const AUTHORITY_REQUIRED = new Set(['assigned','en_route','started','completed','qa_ready','closed']);
const REVIEW_REQUIRED = new Set(['completed','qa_ready','closed']);
function clean(v){return typeof v==='string'?v.trim():'';}
function assertCompany(input){
  for(const key of LEGACY_TENANT_KEYS) if(input?.[key]!=null) throw new Error(`jobs-lifecycle-legacy-tenant-forbidden:${key}`);
  const company_id=clean(input?.company_id); if(!company_id) throw new Error('jobs-lifecycle-company-id-required'); return company_id;
}
export function allowedJobTransitions(state){
  if(!JOB_STATES.includes(state)) throw new Error(`jobs-lifecycle-state-invalid:${state}`);
  return [...JOB_TRANSITIONS[state]];
}
export function evaluateJobTransition(input={}){
  const company_id=assertCompany(input);
  const from=clean(input.from_state), to=clean(input.to_state);
  if(!JOB_STATES.includes(from)||!JOB_STATES.includes(to)) return {allowed:false,company_id,from_state:from,to_state:to,reason:'UNKNOWN_STATE',authority_granted:false,execution_permitted:false};
  if(!JOB_TRANSITIONS[from].includes(to)) return {allowed:false,company_id,from_state:from,to_state:to,reason:'TRANSITION_NOT_ALLOWED',authority_granted:false,execution_permitted:false};
  const sameCompany=!input.job_company_id||clean(input.job_company_id)===company_id;
  if(!sameCompany) return {allowed:false,company_id,from_state:from,to_state:to,reason:'CROSS_COMPANY_JOB',authority_granted:false,execution_permitted:false};
  const authority_required=AUTHORITY_REQUIRED.has(to);
  const authority_verified=input.authority_verified===true;
  if(authority_required&&!authority_verified) return {allowed:false,company_id,from_state:from,to_state:to,reason:'AUTHORITY_REQUIRED',authority_required:true,authority_granted:false,execution_permitted:false};
  const review_required=REVIEW_REQUIRED.has(to);
  if(review_required&&input.review_gate_passed!==true) return {allowed:false,company_id,from_state:from,to_state:to,reason:'REVIEW_GATE_REQUIRED',authority_required,review_required:true,authority_granted:false,execution_permitted:false};
  return {allowed:true,transition_permitted:true,company_id,from_state:from,to_state:to,reason:'ALLOWED',authority_required,review_required,authority_granted:false,execution_permitted:false,requires_command_bus:true,identity_confers_authority:false};
}
export const JOB_LIFECYCLE_CONTRACT = Object.freeze({
 schema:'titan.zero.jobs.lifecycle.v1',company_boundary:'company_id',canonical_owner:'Titan Field',worker:'Jobs Agent',states:JOB_STATES,transitions:JOB_TRANSITIONS,
 terminal_state:'closed',reopen_target:'started',ai_identity_confers_authority:false,authority_is_external:true,
 review_gates:{completed:'completion-readiness',qa_ready:'quality-review',closed:'close-authority'},
 idempotency:{transition_key_fields:['company_id','job_id','from_state','to_state','operation_id']}
});
