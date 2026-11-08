import { assertTitanWorkforceLifecycleCompany, isTitanWorkforceAssignableState, type TitanWorkforceHealthState, type TitanWorkforceLifecycleState } from './contracts.js';
import type { TitanWorkforceAgentRegistration } from './registration.js';

export const TITAN_WORKFORCE_HEALTH_CONTRACT = Object.freeze({
  schema: 'titan.workforce.lifecycle-health.contract.v1',
  companyBoundary: 'company_id' as const,
  assignableRequiresLifecycle: 'ENABLED' as const,
  assignableRequiresHealth: 'READY' as const,
  degradedAcceptsNewAssignments: false as const,
  unavailableAcceptsNewAssignments: false as const,
  compatibilityRequired: true as const,
  healthGrantsAuthority: false as const,
  compatibilityGrantsAuthority: false as const,
});

export type TitanWorkforceHealthProjection = Readonly<{
  schema: 'titan.workforce.lifecycle-health.v1';
  company_id: string;
  agent_key: string;
  lifecycle_state: TitanWorkforceLifecycleState;
  health_state: TitanWorkforceHealthState;
  readiness_reasons: readonly string[];
  accepts_new_assignments: boolean;
  execution_permitted: false;
  grants_authority: false;
}>;

export type TitanWorkforceAssignmentRequirement = Readonly<{
  capability_id: string;
  min_version?: string;
}>;

export type TitanWorkforceAssignmentCompatibility = Readonly<{
  schema: 'titan.workforce.lifecycle-assignment-compatibility.v1';
  company_id: string;
  agent_key: string;
  compatible: boolean;
  assignable: boolean;
  missing_capabilities: readonly string[];
  incompatible_capabilities: readonly string[];
  missing_domains: readonly string[];
  reasons: readonly string[];
  requires_authority_evaluation: true;
  assignment_permitted: false;
  execution_permitted: false;
  grants_authority: false;
}>;

function clean(value: unknown, max = 180): string { return String(value ?? '').trim().slice(0,max); }
function semver(value: unknown): readonly number[] {
  const v=clean(value,80);
  if(!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(v)) throw new Error('capability-version-semver-required');
  return v.split(/[+-]/,1)[0].split('.').map(Number);
}
function gteVersion(actual: string, minimum: string): boolean {
  const a=semver(actual), b=semver(minimum);
  for(let i=0;i<3;i+=1){ if(a[i]>b[i]) return true; if(a[i]<b[i]) return false; }
  return true;
}

export function projectTitanWorkforceHealth(input: {
  company_id: string;
  agent_key: string;
  lifecycle_state: TitanWorkforceLifecycleState;
  health_state: TitanWorkforceHealthState;
  readiness_reasons?: readonly string[];
}): TitanWorkforceHealthProjection {
  const company_id=assertTitanWorkforceLifecycleCompany(input.company_id);
  const agent_key=clean(input.agent_key,128).toLowerCase();
  if(!agent_key) throw new Error('agent_key-required');
  const reasons=[...new Set((input.readiness_reasons ?? []).map(x=>clean(x,240)).filter(Boolean))].sort();
  if(input.health_state==='READY' && reasons.length) throw new Error('ready-health-cannot-have-blocking-reasons');
  const accepts_new_assignments=isTitanWorkforceAssignableState(input.lifecycle_state,input.health_state);
  return Object.freeze({
    schema:'titan.workforce.lifecycle-health.v1', company_id, agent_key,
    lifecycle_state:input.lifecycle_state, health_state:input.health_state,
    readiness_reasons:Object.freeze(reasons), accepts_new_assignments,
    execution_permitted:false, grants_authority:false,
  });
}

export function evaluateTitanWorkforceAssignmentCompatibility(input: {
  company_id: string;
  registration: TitanWorkforceAgentRegistration;
  health: TitanWorkforceHealthProjection;
  required_capabilities?: readonly TitanWorkforceAssignmentRequirement[];
  required_domains?: readonly string[];
}): TitanWorkforceAssignmentCompatibility {
  const company_id=assertTitanWorkforceLifecycleCompany(input.company_id);
  const {registration,health}=input;
  if(registration.company_id!==company_id || health.company_id!==company_id) throw new Error('workforce-lifecycle-assignment-cross-company');
  if(registration.agent_key!==health.agent_key) throw new Error('workforce-lifecycle-assignment-agent-mismatch');
  const capabilityMap=new Map(registration.capabilities.map(c=>[c.capability_id,c] as const));
  const missing:string[]=[]; const incompatible:string[]=[];
  for(const requirement of input.required_capabilities ?? []){
    const id=clean(requirement.capability_id,128).toLowerCase();
    if(!id) throw new Error('required-capability-id-required');
    const cap=capabilityMap.get(id);
    if(!cap){ missing.push(id); continue; }
    if(requirement.min_version && !gteVersion(cap.version,requirement.min_version)) incompatible.push(`${id}@>=${requirement.min_version}`);
  }
  const domains=new Set(registration.operational_domains.map(d=>d.toLowerCase()));
  const missingDomains=[...new Set((input.required_domains ?? []).map(d=>clean(d,128).toLowerCase()).filter(Boolean).filter(d=>!domains.has(d)))].sort();
  const compatible=!missing.length && !incompatible.length && !missingDomains.length;
  const reasons:string[]=[];
  if(!health.accepts_new_assignments) reasons.push(`health-or-lifecycle-not-assignable:${health.lifecycle_state}:${health.health_state}`);
  if(missing.length) reasons.push('missing-capabilities');
  if(incompatible.length) reasons.push('incompatible-capability-version');
  if(missingDomains.length) reasons.push('missing-operational-domain');
  return Object.freeze({
    schema:'titan.workforce.lifecycle-assignment-compatibility.v1', company_id,
    agent_key:registration.agent_key, compatible,
    assignable:compatible && health.accepts_new_assignments,
    missing_capabilities:Object.freeze([...new Set(missing)].sort()),
    incompatible_capabilities:Object.freeze([...new Set(incompatible)].sort()),
    missing_domains:Object.freeze(missingDomains), reasons:Object.freeze(reasons),
    requires_authority_evaluation:true, assignment_permitted:false,
    execution_permitted:false, grants_authority:false,
  });
}
