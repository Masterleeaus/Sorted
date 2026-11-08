import { assertTitanWorkforceLifecycleCompany, type TitanWorkforceLifecycleState } from './contracts.js';
import type { TitanWorkforceAgentRegistration } from './registration.js';

export const TITAN_WORKFORCE_RETIREMENT_CONTRACT = Object.freeze({
  schema: 'titan.workforce.lifecycle-retirement.contract.v1',
  companyBoundary: 'company_id' as const,
  platformManagerApprovalRequired: true as const,
  activeWorkMustBeZero: true as const,
  dependencyResolutionRequired: true as const,
  orphanPreventionRequired: true as const,
  historyRetentionRequired: true as const,
  auditRetentionRequired: true as const,
  configurationSnapshotRequired: true as const,
  retentionPolicyRequired: true as const,
  automaticUninstall: false as const,
  automaticDataDeletion: false as const,
  automaticAuthorityChange: false as const,
  retirementGrantsAuthority: false as const,
});

export type TitanWorkforceRetirementPhase = 'RETIREMENT_READY' | 'BLOCKED' | 'APPROVED';

export type TitanWorkforceRetirementDependency = Readonly<{
  dependency_id: string;
  dependency_kind: 'AGENT' | 'WORKFLOW' | 'SCHEDULE' | 'INTEGRATION' | 'OTHER';
  resolution: 'RETAIN' | 'REPOINT' | 'REMOVE_APPROVED' | 'UNRESOLVED';
  resolution_ref: string | null;
}>;

export type TitanWorkforceRetirementResource = Readonly<{
  resource_id: string;
  disposition: 'RETAIN' | 'TRANSFER' | 'DELETE_APPROVED' | 'UNRESOLVED';
  disposition_ref: string | null;
}>;

export type TitanWorkforceRetirementPlan = Readonly<{
  schema: 'titan.workforce.lifecycle-retirement.v1';
  company_id: string;
  agent_key: string;
  agent_version: string;
  lifecycle_state: TitanWorkforceLifecycleState;
  active_work_count: number;
  dependencies: readonly TitanWorkforceRetirementDependency[];
  owned_resources: readonly TitanWorkforceRetirementResource[];
  retained_history_refs: readonly string[];
  retained_audit_refs: readonly string[];
  configuration_snapshot_ref: string | null;
  retention_policy_ref: string | null;
  phase: TitanWorkforceRetirementPhase;
  blockers: readonly string[];
  orphan_prevention_verified: boolean;
  retention_verified: boolean;
  requires_platform_manager_approval: true;
  requires_fresh_authority_evaluation: true;
  uninstall_permitted: false;
  automatic_uninstall: false;
  automatic_data_deletion: false;
  execution_permitted: false;
  grants_authority: false;
}>;

export type TitanWorkforceRetiredAgentRecord = Readonly<{
  schema: 'titan.workforce.lifecycle-retired-agent.v1';
  company_id: string;
  agent_key: string;
  agent_version: string;
  lifecycle_state: 'RETIRED';
  retirement_audit_ref: string;
  retained_history_refs: readonly string[];
  retained_audit_refs: readonly string[];
  configuration_snapshot_ref: string;
  retention_policy_ref: string;
  dependencies: readonly TitanWorkforceRetirementDependency[];
  owned_resources: readonly TitanWorkforceRetirementResource[];
  approved_by_platform_manager: true;
  automatic_uninstall: false;
  automatic_data_deletion: false;
  execution_permitted: false;
  grants_authority: false;
}>;

const LEGACY_KEYS = new Set(['tenant_id','tenant_company_id','tenant','tenantCompanyId','organisation_id','organization_id']);
function clean(value: unknown, max = 400): string { return String(value ?? '').trim().slice(0,max); }
function id(value: unknown, field: string): string {
  const normalized=clean(value,180).toLowerCase();
  if(!/^[a-z0-9][a-z0-9._:-]{0,179}$/.test(normalized)) throw new Error(`${field}-invalid`);
  return normalized;
}
function count(value: unknown): number {
  const n=Number(value ?? 0);
  if(!Number.isInteger(n) || n<0) throw new Error('active_work_count-invalid');
  return n;
}
function rejectLegacy(value: unknown, path='retirement'): void {
  if(!value || typeof value!=='object') return;
  if(Array.isArray(value)){ value.forEach((item,index)=>rejectLegacy(item,`${path}[${index}]`)); return; }
  for(const [key,child] of Object.entries(value as Record<string,unknown>)){
    if(LEGACY_KEYS.has(key)) throw new Error(`legacy-company-boundary:${path}.${key}`);
    rejectLegacy(child,`${path}.${key}`);
  }
}
function refs(values: readonly unknown[] | undefined): readonly string[] {
  return Object.freeze([...new Set((values ?? []).map(v=>clean(v)).filter(Boolean))].sort());
}
function dependency(raw: Record<string,unknown>, index: number): TitanWorkforceRetirementDependency {
  const dependency_id=id(raw.dependency_id ?? `dependency-${index+1}`,'dependency_id');
  const kind=clean(raw.dependency_kind ?? 'OTHER',40).toUpperCase();
  if(!['AGENT','WORKFLOW','SCHEDULE','INTEGRATION','OTHER'].includes(kind)) throw new Error(`dependency-kind-invalid:${dependency_id}`);
  const resolution=clean(raw.resolution ?? 'UNRESOLVED',40).toUpperCase();
  if(!['RETAIN','REPOINT','REMOVE_APPROVED','UNRESOLVED'].includes(resolution)) throw new Error(`dependency-resolution-invalid:${dependency_id}`);
  const resolution_ref=clean(raw.resolution_ref)||null;
  return Object.freeze({dependency_id,dependency_kind:kind as TitanWorkforceRetirementDependency['dependency_kind'],resolution:resolution as TitanWorkforceRetirementDependency['resolution'],resolution_ref});
}
function resource(raw: Record<string,unknown>, index: number): TitanWorkforceRetirementResource {
  const resource_id=id(raw.resource_id ?? `resource-${index+1}`,'resource_id');
  const disposition=clean(raw.disposition ?? 'UNRESOLVED',40).toUpperCase();
  if(!['RETAIN','TRANSFER','DELETE_APPROVED','UNRESOLVED'].includes(disposition)) throw new Error(`resource-disposition-invalid:${resource_id}`);
  const disposition_ref=clean(raw.disposition_ref)||null;
  return Object.freeze({resource_id,disposition:disposition as TitanWorkforceRetirementResource['disposition'],disposition_ref});
}

export function buildTitanWorkforceRetirementPlan(input: {
  company_id: string;
  registration: TitanWorkforceAgentRegistration;
  lifecycle_state: TitanWorkforceLifecycleState;
  active_work_count?: number;
  dependencies?: readonly Record<string,unknown>[];
  owned_resources?: readonly Record<string,unknown>[];
  retained_history_refs?: readonly string[];
  retained_audit_refs?: readonly string[];
  configuration_snapshot_ref?: string | null;
  retention_policy_ref?: string | null;
}): TitanWorkforceRetirementPlan {
  rejectLegacy(input);
  const company_id=assertTitanWorkforceLifecycleCompany(input.company_id);
  if(input.registration.company_id!==company_id) throw new Error('cross-company-retirement');
  const active_work_count=count(input.active_work_count);
  const dependencies=Object.freeze((input.dependencies ?? []).map((item,index)=>dependency(item,index)).sort((a,b)=>a.dependency_id.localeCompare(b.dependency_id)));
  const owned_resources=Object.freeze((input.owned_resources ?? []).map((item,index)=>resource(item,index)).sort((a,b)=>a.resource_id.localeCompare(b.resource_id)));
  const retained_history_refs=refs(input.retained_history_refs);
  const retained_audit_refs=refs(input.retained_audit_refs);
  const configuration_snapshot_ref=clean(input.configuration_snapshot_ref)||null;
  const retention_policy_ref=clean(input.retention_policy_ref)||null;
  const blockers:string[]=[];
  if(!['REGISTERED','DISABLED'].includes(input.lifecycle_state)) blockers.push(`retirement-lifecycle-not-safe:${input.lifecycle_state}`);
  if(active_work_count>0) blockers.push('active-work-must-be-zero-before-retirement');
  for(const item of dependencies){
    if(item.resolution==='UNRESOLVED') blockers.push(`dependency-unresolved:${item.dependency_id}`);
    else if(!item.resolution_ref) blockers.push(`dependency-resolution-ref-required:${item.dependency_id}`);
  }
  for(const item of owned_resources){
    if(item.disposition==='UNRESOLVED') blockers.push(`owned-resource-unresolved:${item.resource_id}`);
    else if(!item.disposition_ref) blockers.push(`resource-disposition-ref-required:${item.resource_id}`);
  }
  if(!retained_history_refs.length) blockers.push('retained-history-reference-required');
  if(!retained_audit_refs.length) blockers.push('retained-audit-reference-required');
  if(!configuration_snapshot_ref) blockers.push('configuration-snapshot-reference-required');
  if(!retention_policy_ref) blockers.push('retention-policy-reference-required');
  const uniqueBlockers=Object.freeze([...new Set(blockers)].sort());
  const orphan_prevention_verified=dependencies.every(d=>d.resolution!=='UNRESOLVED' && Boolean(d.resolution_ref)) && owned_resources.every(r=>r.disposition!=='UNRESOLVED' && Boolean(r.disposition_ref));
  const retention_verified=Boolean(retained_history_refs.length && retained_audit_refs.length && configuration_snapshot_ref && retention_policy_ref);
  return Object.freeze({
    schema:'titan.workforce.lifecycle-retirement.v1',company_id,agent_key:input.registration.agent_key,agent_version:input.registration.agent_version,
    lifecycle_state:input.lifecycle_state,active_work_count,dependencies,owned_resources,retained_history_refs,retained_audit_refs,configuration_snapshot_ref,retention_policy_ref,
    phase:uniqueBlockers.length?'BLOCKED':'RETIREMENT_READY',blockers:uniqueBlockers,orphan_prevention_verified,retention_verified,
    requires_platform_manager_approval:true,requires_fresh_authority_evaluation:true,uninstall_permitted:false,automatic_uninstall:false,automatic_data_deletion:false,execution_permitted:false,grants_authority:false,
  });
}

export function approveTitanWorkforceRetirement(plan: TitanWorkforceRetirementPlan, input: {
  company_id: string;
  platform_manager_approved?: boolean;
  retirement_audit_ref?: string;
}): TitanWorkforceRetiredAgentRecord {
  const company_id=assertTitanWorkforceLifecycleCompany(input.company_id);
  if(company_id!==plan.company_id) throw new Error('cross-company-retirement-approval');
  if(plan.phase!=='RETIREMENT_READY') throw new Error(`retirement-not-ready:${plan.phase}`);
  if(input.platform_manager_approved!==true) throw new Error('platform-manager-approval-required');
  const retirement_audit_ref=clean(input.retirement_audit_ref);
  if(!retirement_audit_ref) throw new Error('retirement-audit-ref-required');
  return Object.freeze({
    schema:'titan.workforce.lifecycle-retired-agent.v1',company_id:plan.company_id,agent_key:plan.agent_key,agent_version:plan.agent_version,lifecycle_state:'RETIRED',retirement_audit_ref,
    retained_history_refs:plan.retained_history_refs,retained_audit_refs:Object.freeze([...new Set([...plan.retained_audit_refs,retirement_audit_ref])].sort()),configuration_snapshot_ref:plan.configuration_snapshot_ref!,retention_policy_ref:plan.retention_policy_ref!,dependencies:plan.dependencies,owned_resources:plan.owned_resources,
    approved_by_platform_manager:true,automatic_uninstall:false,automatic_data_deletion:false,execution_permitted:false,grants_authority:false,
  });
}
