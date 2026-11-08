import { assertTitanWorkforceLifecycleCompany, type TitanWorkforceLifecycleState } from './contracts.js';
import type { TitanWorkforceAgentRegistration } from './registration.js';
import type { TitanWorkforceAssignmentCompatibility, TitanWorkforceHealthProjection } from './health.js';

export const TITAN_WORKFORCE_REPLACEMENT_CONTRACT = Object.freeze({
  schema: 'titan.workforce.lifecycle-replacement.contract.v1',
  companyBoundary: 'company_id' as const,
  platformManagerApprovalRequired: true as const,
  sourceHistoryPreserved: true as const,
  activeTaskContinuityRequired: true as const,
  sourceDrainRequiredWhenActive: true as const,
  targetReadinessRequired: true as const,
  targetCompatibilityRequired: true as const,
  automaticTaskTransfer: false as const,
  automaticAssignment: false as const,
  automaticExecution: false as const,
  automaticAuthorityChange: false as const,
  replacementGrantsAuthority: false as const,
});

export type TitanWorkforceReplacementPhase =
  | 'PREPARED'
  | 'DRAINING_SOURCE'
  | 'CUTOVER_READY'
  | 'COMPLETED'
  | 'BLOCKED';

export type TitanWorkforceTaskContinuity = Readonly<{
  task_id: string;
  source_agent_key: string;
  target_agent_key: string;
  handoff_ref: string;
  execution_receipt_ref: string | null;
  requires_explicit_handoff: true;
  transferred_automatically: false;
}>;

export type TitanWorkforceReplacementPlan = Readonly<{
  schema: 'titan.workforce.lifecycle-replacement.v1';
  company_id: string;
  replacement_id: string;
  source_agent_key: string;
  target_agent_key: string;
  source_version: string;
  target_version: string;
  source_lifecycle_state: TitanWorkforceLifecycleState;
  target_lifecycle_state: TitanWorkforceLifecycleState;
  active_work_count: number;
  continuity: readonly TitanWorkforceTaskContinuity[];
  preserved_history_refs: readonly string[];
  audit_refs: readonly string[];
  phase: TitanWorkforceReplacementPhase;
  blockers: readonly string[];
  source_must_drain: boolean;
  target_may_receive_new_work_after_cutover: boolean;
  requires_platform_manager_approval: true;
  requires_fresh_authority_evaluation: true;
  automatic_task_transfer: false;
  automatic_assignment: false;
  execution_permitted: false;
  grants_authority: false;
}>;

const LEGACY_KEYS = new Set(['tenant_id','tenant_company_id','tenant','tenantCompanyId','organisation_id','organization_id']);
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
function clean(value: unknown, max = 240): string { return String(value ?? '').trim().slice(0,max); }
function id(value: unknown, field: string): string {
  const v=clean(value,180).toLowerCase();
  if(!/^[a-z0-9][a-z0-9._:-]{0,179}$/.test(v)) throw new Error(`${field}-invalid`);
  return v;
}
function semver(value: unknown, field: string): string {
  const v=clean(value,80);
  if(!SEMVER_RE.test(v)) throw new Error(`${field}-semver-required`);
  return v;
}
function count(value: unknown): number {
  const n=Number(value ?? 0);
  if(!Number.isInteger(n) || n<0) throw new Error('active_work_count-invalid');
  return n;
}
function rejectLegacy(value: unknown, path='replacement'): void {
  if(!value || typeof value!=='object') return;
  if(Array.isArray(value)){ value.forEach((v,i)=>rejectLegacy(v,`${path}[${i}]`)); return; }
  for(const [k,v] of Object.entries(value as Record<string,unknown>)){
    if(LEGACY_KEYS.has(k)) throw new Error(`legacy-company-boundary:${path}.${k}`);
    rejectLegacy(v,`${path}.${k}`);
  }
}
function normalizeRefs(values: readonly unknown[] | undefined, field: string): readonly string[] {
  const refs=[...new Set((values ?? []).map(v=>clean(v,400)).filter(Boolean))].sort();
  if(refs.some(r=>r.length===0)) throw new Error(`${field}-invalid`);
  return Object.freeze(refs);
}

export function buildTitanWorkforceReplacementPlan(input: {
  company_id: string;
  source_registration: TitanWorkforceAgentRegistration;
  target_registration: TitanWorkforceAgentRegistration;
  source_health: TitanWorkforceHealthProjection;
  target_health: TitanWorkforceHealthProjection;
  target_compatibility: TitanWorkforceAssignmentCompatibility;
  active_task_ids?: readonly string[];
  continuity?: readonly {task_id:string; handoff_ref:string; execution_receipt_ref?:string|null}[];
  preserved_history_refs?: readonly string[];
  audit_refs?: readonly string[];
}): TitanWorkforceReplacementPlan {
  rejectLegacy(input);
  const company_id=assertTitanWorkforceLifecycleCompany(input.company_id);
  const source=input.source_registration, target=input.target_registration;
  if(source.company_id!==company_id || target.company_id!==company_id || input.source_health.company_id!==company_id || input.target_health.company_id!==company_id || input.target_compatibility.company_id!==company_id) throw new Error('cross-company-replacement');
  if(source.agent_key!==input.source_health.agent_key) throw new Error('source-health-agent-mismatch');
  if(target.agent_key!==input.target_health.agent_key || target.agent_key!==input.target_compatibility.agent_key) throw new Error('target-evidence-agent-mismatch');
  if(source.agent_key===target.agent_key) throw new Error('replacement-target-must-be-distinct-agent');
  const source_version=semver(source.agent_version,'source_version');
  const target_version=semver(target.agent_version,'target_version');
  const taskIds=[...new Set((input.active_task_ids ?? []).map(v=>id(v,'task_id'))) ].sort();
  const continuityByTask=new Map<string,TitanWorkforceTaskContinuity>();
  for(const raw of input.continuity ?? []){
    const task_id=id(raw.task_id,'task_id');
    if(continuityByTask.has(task_id)) throw new Error(`duplicate-continuity-task:${task_id}`);
    const handoff_ref=clean(raw.handoff_ref,400);
    if(!handoff_ref) throw new Error(`continuity-handoff-ref-required:${task_id}`);
    continuityByTask.set(task_id,Object.freeze({task_id,source_agent_key:source.agent_key,target_agent_key:target.agent_key,handoff_ref,execution_receipt_ref:clean(raw.execution_receipt_ref,400)||null,requires_explicit_handoff:true,transferred_automatically:false}));
  }
  const blockers:string[]=[];
  if(!['ENABLED','PAUSED','DRAINING','DISABLED'].includes(input.source_health.lifecycle_state)) blockers.push(`source-lifecycle-not-replaceable:${input.source_health.lifecycle_state}`);
  if(input.target_health.lifecycle_state!=='ENABLED') blockers.push(`target-lifecycle-not-enabled:${input.target_health.lifecycle_state}`);
  if(input.target_health.health_state!=='READY' || !input.target_health.accepts_new_assignments) blockers.push(`target-not-ready:${input.target_health.lifecycle_state}:${input.target_health.health_state}`);
  if(!input.target_compatibility.compatible || !input.target_compatibility.assignable) blockers.push('target-not-compatible-for-new-work');
  for(const taskId of taskIds) if(!continuityByTask.has(taskId)) blockers.push(`active-task-continuity-missing:${taskId}`);
  for(const taskId of continuityByTask.keys()) if(!taskIds.includes(taskId)) blockers.push(`continuity-task-not-active:${taskId}`);
  const history=normalizeRefs(input.preserved_history_refs,'preserved_history_refs');
  const audit=normalizeRefs(input.audit_refs,'audit_refs');
  if(!history.length) blockers.push('source-history-reference-required');
  if(!audit.length) blockers.push('replacement-audit-reference-required');
  const active_work_count=count(taskIds.length);
  const uniqueBlockers=Object.freeze([...new Set(blockers)].sort());
  const source_must_drain=active_work_count>0;
  const phase:TitanWorkforceReplacementPhase=uniqueBlockers.length?'BLOCKED':source_must_drain?'DRAINING_SOURCE':'CUTOVER_READY';
  return Object.freeze({
    schema:'titan.workforce.lifecycle-replacement.v1',company_id,
    replacement_id:`${source.agent_key}->${target.agent_key}:${source_version}->${target_version}`,
    source_agent_key:source.agent_key,target_agent_key:target.agent_key,source_version,target_version,
    source_lifecycle_state:input.source_health.lifecycle_state,target_lifecycle_state:input.target_health.lifecycle_state,
    active_work_count,continuity:Object.freeze(taskIds.map(taskId=>continuityByTask.get(taskId)!).filter(Boolean)),
    preserved_history_refs:history,audit_refs:audit,phase,blockers:uniqueBlockers,source_must_drain,
    target_may_receive_new_work_after_cutover:phase==='CUTOVER_READY',requires_platform_manager_approval:true,
    requires_fresh_authority_evaluation:true,automatic_task_transfer:false,automatic_assignment:false,
    execution_permitted:false,grants_authority:false,
  });
}

export function advanceTitanWorkforceReplacementPlan(plan: TitanWorkforceReplacementPlan, input: {
  company_id: string;
  active_task_ids?: readonly string[];
  platform_manager_approved?: boolean;
  cutover_audit_ref?: string;
}): TitanWorkforceReplacementPlan {
  const company_id=assertTitanWorkforceLifecycleCompany(input.company_id);
  if(company_id!==plan.company_id) throw new Error('cross-company-replacement-transition');
  if(plan.phase==='BLOCKED' || plan.phase==='COMPLETED') throw new Error(`replacement-invalid-transition:${plan.phase}`);
  const active=[...new Set((input.active_task_ids ?? []).map(v=>id(v,'task_id'))) ].sort();
  if(plan.phase==='DRAINING_SOURCE'){
    if(active.length) return Object.freeze({...plan,active_work_count:active.length,phase:'DRAINING_SOURCE' as const,target_may_receive_new_work_after_cutover:false});
    return Object.freeze({...plan,active_work_count:0,phase:'CUTOVER_READY' as const,target_may_receive_new_work_after_cutover:true});
  }
  if(plan.phase==='CUTOVER_READY'){
    if(input.platform_manager_approved!==true) throw new Error('platform-manager-approval-required');
    const cutoverRef=clean(input.cutover_audit_ref,400);
    if(!cutoverRef) throw new Error('cutover-audit-ref-required');
    return Object.freeze({...plan,phase:'COMPLETED' as const,audit_refs:Object.freeze([...new Set([...plan.audit_refs,cutoverRef])].sort()),target_may_receive_new_work_after_cutover:true,execution_permitted:false,grants_authority:false,automatic_task_transfer:false,automatic_assignment:false});
  }
  throw new Error(`replacement-invalid-transition:${plan.phase}`);
}
