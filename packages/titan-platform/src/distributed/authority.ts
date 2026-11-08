import type { CompanyBound, DistributedNodeRef, IntelligencePlacement } from './contracts.js';

export type AuthorityBand = 'observe'|'recommend'|'prepare'|'ask_execute'|'trusted_auto'|'autonomous'|'predictive';
export type AssuranceState = 'green'|'amber'|'red';

export interface DistributedIdentityEvidence extends CompanyBound {
  node_id?: string;
  provider?: string;
  model?: string;
  trust_ref?: string;
  trust_score?: number;
  capability_claims?: readonly string[];
}

export interface AuthorityCeilings extends CompanyBound {
  governance_allowed: boolean;
  autonomy_band: AuthorityBand;
  risk_allowed: boolean;
  assurance: AssuranceState;
  capability_allowed: boolean;
  authority_ref: string;
}

export interface DistributedAuthorityDecision extends CompanyBound {
  allowed: boolean;
  effective_band: AuthorityBand;
  authority_ref: string;
  reason_codes: readonly string[];
  identity_effect: false;
  trust_effect: false;
}

const BANDS: readonly AuthorityBand[]=['observe','recommend','prepare','ask_execute','trusted_auto','autonomous','predictive'];
const rank=(b:AuthorityBand)=>BANDS.indexOf(b);

/** Identity/trust can remove an execution target, but can never create business authority. */
export function evaluateDistributedAuthority(
  requested: AuthorityBand,
  ceilings: AuthorityCeilings,
  identity: DistributedIdentityEvidence,
): DistributedAuthorityDecision {
  if (ceilings.company_id!==identity.company_id) throw new Error('cross-company-authority-evidence');
  const reasons:string[]=[];
  if (!ceilings.capability_allowed) reasons.push('CAPABILITY_DENIED');
  if (!ceilings.risk_allowed) reasons.push('RISK_DENIED');
  if (ceilings.assurance==='red') reasons.push('ASSURANCE_RED');
  if (!ceilings.governance_allowed) reasons.push('GOVERNANCE_DENIED');
  if (rank(requested)>rank(ceilings.autonomy_band)) reasons.push('AUTONOMY_CEILING');
  // Deliberately do not use node/provider/model/trust_score as positive authority inputs.
  return {company_id:ceilings.company_id,allowed:reasons.length===0,effective_band:rank(requested)<=rank(ceilings.autonomy_band)?requested:ceilings.autonomy_band,authority_ref:ceilings.authority_ref,reason_codes:reasons,identity_effect:false,trust_effect:false};
}

export function assertIdentityAuthorityNeutral(value: DistributedNodeRef|IntelligencePlacement|DistributedIdentityEvidence): void {
  const v=value as unknown as Record<string,unknown>;
  if (v.authority_granted===true || v.authority_effect===true) throw new Error('identity-cannot-grant-authority');
}

export function assertPlacementWithinAuthority(decision:DistributedAuthorityDecision, target:CompanyBound):void {
  if (decision.company_id!==target.company_id) throw new Error('cross-company-authority-placement');
  if (!decision.allowed) throw new Error('distributed-business-authority-denied');
}

export interface WorkforceTrustEvidence extends CompanyBound {
  agent_id:string;
  capability:string;
  successful_cycles:number;
  required_cycles:number;
  worker_accepted:boolean;
  user_approved:boolean;
  system_unblocked:boolean;
  evidence_refs:readonly string[];
}

export interface TrustEligibility extends CompanyBound {
  eligible:boolean;
  authority_granted:false;
  agent_id:string;
  capability:string;
  reason_codes:readonly string[];
  evidence_refs:readonly string[];
}

/** Trust cycles can make a capability eligible for authority evaluation, never grant it. */
export function evaluateTrustEligibility(e:WorkforceTrustEvidence):TrustEligibility {
  const reasons:string[]=[];
  if (e.successful_cycles<e.required_cycles) reasons.push('TRUST_CYCLES_INCOMPLETE');
  if (!e.system_unblocked) reasons.push('SYSTEM_NOT_UNBLOCKED');
  if (!e.user_approved) reasons.push('USER_APPROVAL_REQUIRED');
  if (!e.worker_accepted) reasons.push('WORKER_ACCEPTANCE_REQUIRED');
  if (e.evidence_refs.length===0) reasons.push('TRUST_EVIDENCE_REQUIRED');
  return {company_id:e.company_id,eligible:reasons.length===0,authority_granted:false,agent_id:e.agent_id,capability:e.capability,reason_codes:reasons,evidence_refs:e.evidence_refs};
}

export function assertTrustEligibilityMatchesAuthority(e:TrustEligibility,ceilings:AuthorityCeilings):void {
  if (e.company_id!==ceilings.company_id) throw new Error('cross-company-trust-authority');
  if (!e.eligible) throw new Error('trust-not-eligible-for-authority-evaluation');
  if (e.authority_granted!==false) throw new Error('trust-cannot-grant-authority');
}
