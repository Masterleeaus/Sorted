import type { CompanyBound, DistributedFailure } from './contracts.js';
import type { CanonicalDistributedContext } from './context.js';
import { assertCanonicalDistributedContext } from './context.js';
import type { ExecutionLease } from './execution.js';
import type { FabricKind } from './router.js';
export type RevocationReason = 'trust_revoked'|'node_revoked'|'lease_revoked'|'authority_changed'|'company_disabled'|'security_event';

export interface RevocationNotice extends CompanyBound {
  revocation_id:string; target_id:string; reason:RevocationReason; created_at:string; fabrics:readonly FabricKind[];
}
export interface FabricExecutionState extends CompanyBound {
  fabric:FabricKind; target_id:string; lease?:ExecutionLease; trusted:boolean; revoked:boolean; healthy:boolean;
}
export function propagateRevocation(notice:RevocationNotice, states:readonly FabricExecutionState[]):FabricExecutionState[] {
  return states.map(s=>s.company_id===notice.company_id && s.target_id===notice.target_id && notice.fabrics.includes(s.fabric)
    ? {...s,revoked:true,trusted:false,lease:s.lease?{...s.lease,revoked_at:notice.created_at}:undefined}:s);
}
export function assertFabricExecutionSafe(state:FabricExecutionState):void {
  if(state.revoked) throw new Error('distributed-target-revoked');
  if(!state.trusted) throw new Error('distributed-target-untrusted');
  if(!state.healthy) throw new Error('distributed-target-unhealthy');
}

export interface OfflineCommand extends CanonicalDistributedContext {
  command_id:string; capability:string; mutation_kind:string; queued_at:string; authority_snapshot_ref:string;
  state:'queued'|'revalidating'|'released'|'denied'; authority_recheck_required:true;
}
export function queueOfflineCommand(input:Omit<OfflineCommand,'state'|'authority_recheck_required'>):OfflineCommand {
  assertCanonicalDistributedContext(input); return {...input,state:'queued',authority_recheck_required:true};
}

export function revalidateQueuedCommand(command:OfflineCommand, currentCompanyId:string, authorityAllowed:boolean, currentContext:CanonicalDistributedContext=command):OfflineCommand {
  assertCanonicalDistributedContext(command); assertCanonicalDistributedContext(currentContext);
  if(command.company_id!==currentCompanyId || command.company_id!==currentContext.company_id || command.surface!==currentContext.surface || (command.journey??'')!==(currentContext.journey??'')) throw new Error('offline-command-context-mismatch');
  if(!authorityAllowed) return {...command,state:'denied'};
  return {...command,state:'released'};
}
export function assertCanonicalMutationReleased(command:OfflineCommand):void {
  if(command.state!=='released') throw new Error('canonical-mutation-requires-authority-recheck');
}

export interface ResourcePressure { battery:'normal'|'low'|'critical'; thermal:'normal'|'warm'|'hot'|'critical'; memory:'normal'|'pressure'|'critical'; storage:'normal'|'low'|'critical'; }
export type DegradedExecutionMode='normal'|'degraded'|'queue'|'deny';
export function degradedExecutionMode(r:ResourcePressure):DegradedExecutionMode {
  if(r.thermal==='critical'||r.memory==='critical'||r.storage==='critical') return 'deny';
  if(r.battery==='critical') return 'queue';
  if(r.thermal==='hot'||r.memory==='pressure'||r.storage==='low'||r.battery==='low') return 'degraded';
  return 'normal';
}
export function degradedFailure(company_id:string, mode:DegradedExecutionMode):DistributedFailure|undefined {
  if(mode==='normal') return undefined;
  return {company_id,code:`RESOURCE_${mode.toUpperCase()}`,disposition:mode==='queue'?'queue_for_recheck':mode==='degraded'?'degrade':'deny',authority_may_increase:false,reason:'resource-pressure-contracted-execution'};
}

import type { DistributedAuthorityDecision } from './authority.js';

export interface AuthorityBoundOfflineCommand extends OfflineCommand {
  requested_authority_band:string;
}

/** Offline recovery consumes a fresh current authority decision; queued snapshots are provenance only. */
export function revalidateOfflineWithAuthority(command:AuthorityBoundOfflineCommand,current:DistributedAuthorityDecision,currentContext:CanonicalDistributedContext=command):AuthorityBoundOfflineCommand {
  assertCanonicalDistributedContext(currentContext);
  if (command.company_id!==current.company_id || command.company_id!==currentContext.company_id || command.surface!==currentContext.surface || (command.journey??'')!==(currentContext.journey??'')) throw new Error('offline-authority-context-mismatch');
  if (!current.allowed) return {...command,state:'denied'};
  return {...command,state:'released',authority_snapshot_ref:current.authority_ref};
}

export function assertFailoverAuthorityInvariant(before:DistributedAuthorityDecision,after:DistributedAuthorityDecision):void {
  if (before.company_id!==after.company_id) throw new Error('failover-cross-company-authority');
  if (before.authority_ref!==after.authority_ref) throw new Error('failover-cannot-substitute-authority');
  if (!before.allowed && after.allowed) throw new Error('failover-cannot-elevate-authority');
}
