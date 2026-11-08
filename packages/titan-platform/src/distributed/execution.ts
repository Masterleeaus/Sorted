import type { CompanyBound, DistributedFailure } from './contracts.js';
import type { PlacementCandidate, PlacementRequest } from './placement.js';
import { rankPlacementCandidates } from './placement.js';

export interface ExecutionLease extends CompanyBound {
  lease_id: string;
  target_id: string;
  capability: string;
  issued_at: string;
  expires_at: string;
  revoked_at?: string;
  authority_granted: false;
}

export function issueExecutionLease(input: Omit<ExecutionLease,'authority_granted'>): ExecutionLease {
  if (Date.parse(input.expires_at) <= Date.parse(input.issued_at)) throw new Error('execution-lease-invalid-window');
  return {...input, authority_granted:false};
}

export function assertExecutionLeaseUsable(lease: ExecutionLease, request: CompanyBound & {capability:string}, targetId:string, now=new Date()): void {
  if (lease.company_id!==request.company_id) throw new Error('cross-company-execution-lease');
  if (lease.capability!==request.capability || lease.target_id!==targetId) throw new Error('execution-lease-scope-mismatch');
  if (lease.revoked_at) throw new Error('execution-lease-revoked');
  if (Date.parse(lease.expires_at)<=now.getTime()) throw new Error('execution-lease-expired');
}

export interface FailoverDecision {
  selected?: PlacementCandidate;
  attempted_target_ids: readonly string[];
  fallback_from?: string;
  failure?: DistributedFailure;
  reason_codes: readonly string[];
}

export function selectWithFailover(request: PlacementRequest, candidates: readonly PlacementCandidate[], unavailable: ReadonlySet<string>=new Set()): FailoverDecision {
  const ranked=rankPlacementCandidates(request,candidates);
  const attempted:string[]=[];
  for (const candidate of ranked) {
    attempted.push(candidate.target_id);
    if (unavailable.has(candidate.target_id)) continue;
    return {selected:candidate,attempted_target_ids:attempted,fallback_from:attempted.length>1?attempted[0]:undefined,reason_codes:attempted.length>1?['PRIMARY_UNAVAILABLE','SOVEREIGN_FALLBACK_SELECTED']:['PRIMARY_SELECTED']};
  }
  return {attempted_target_ids:attempted,failure:{company_id:request.company_id,code:'NO_EXECUTION_TARGET',disposition:request.network==='offline'?'queue_for_recheck':'deny',authority_may_increase:false,reason:'no-eligible-or-available-target'},reason_codes:['NO_EXECUTION_TARGET']};
}

import type { DistributedAuthorityDecision, DistributedIdentityEvidence } from './authority.js';
import { assertIdentityAuthorityNeutral, assertPlacementWithinAuthority } from './authority.js';

export interface GovernedExecutionLease extends ExecutionLease {
  authority_ref: string;
  effective_band: string;
  identity_snapshot?: DistributedIdentityEvidence;
}

/** Bind placement/execution to an already-issued authority decision. Identity is never a source of authority. */
export function issueGovernedExecutionLease(
  input: Omit<ExecutionLease,'authority_granted'>,
  authority: DistributedAuthorityDecision,
  identity?: DistributedIdentityEvidence,
): GovernedExecutionLease {
  assertPlacementWithinAuthority(authority,input);
  if (identity) {
    if (identity.company_id!==input.company_id) throw new Error('cross-company-execution-identity');
    assertIdentityAuthorityNeutral(identity);
  }
  return {...issueExecutionLease(input),authority_ref:authority.authority_ref,effective_band:authority.effective_band,identity_snapshot:identity};
}

export interface ExecutionTargetState extends CompanyBound {
  target_id:string;
  trusted:boolean;
  healthy:boolean;
  revoked?:boolean;
  provider_available?:boolean;
  model_available?:boolean;
}

/** Trust/health/provider/model loss may revoke a target lease. Recovery requires fresh placement, never authority expansion. */
export function reconcileExecutionLease(lease:GovernedExecutionLease,state:ExecutionTargetState,at:string):GovernedExecutionLease {
  if (lease.company_id!==state.company_id) throw new Error('cross-company-execution-state');
  if (lease.target_id!==state.target_id) throw new Error('execution-target-state-mismatch');
  const unavailable=!state.trusted || !state.healthy || state.revoked===true || state.provider_available===false || state.model_available===false;
  return unavailable && !lease.revoked_at ? {...lease,revoked_at:at} : lease;
}

export interface GovernedFailoverDecision extends FailoverDecision {
  authority_ref:string;
  authority_effect:false;
}

export function selectGovernedWithFailover(
  request:PlacementRequest,
  candidates:readonly PlacementCandidate[],
  authority:DistributedAuthorityDecision,
  unavailable:ReadonlySet<string>=new Set(),
):GovernedFailoverDecision {
  assertPlacementWithinAuthority(authority,request);
  const decision=selectWithFailover(request,candidates,unavailable);
  return {...decision,authority_ref:authority.authority_ref,authority_effect:false};
}
