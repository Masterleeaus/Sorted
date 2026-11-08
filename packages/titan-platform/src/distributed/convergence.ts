import type { DataLocality } from './contracts.js';
import type { CanonicalDistributedContext } from './context.js';
import { assertCanonicalDistributedContext } from './context.js';
import type { OfflineCommand } from './safety.js';
import { assertCanonicalMutationReleased } from './safety.js';

export type DistributedMutationState='prepared'|'authority_rechecked'|'command_bus_accepted'|'canonical_mutated'|'signalled'|'assured'|'denied';
export interface DistributedMutationEnvelope extends CanonicalDistributedContext {
  execution_id:string; command_id:string; capability:string; mutation_kind:string; locality:DataLocality;
  authority_recheck_ref:string; governance_ref:string; risk_ref?:string; autonomy_ref?:string;
  state:DistributedMutationState; canonical_mutation_allowed:false|true;
}
export interface CommandBusAcceptance extends CanonicalDistributedContext { command_id:string; accepted:boolean; receipt_ref:string; }
export interface DistributedSignal extends CanonicalDistributedContext { signal_id:string; topic:string; command_id:string; execution_id:string; created_at:string; }
export interface AssuranceEvidence extends CanonicalDistributedContext { evidence_id:string; execution_id:string; command_receipt_ref:string; signal_ref:string; verified:boolean; created_at:string; }

function sameContext(a:CanonicalDistributedContext,b:CanonicalDistributedContext):boolean {
  return a.company_id===b.company_id && a.surface===b.surface && (a.journey??'')===(b.journey??'');
}
function assertSameContext(a:CanonicalDistributedContext,b:CanonicalDistributedContext,code:string):void {
  assertCanonicalDistributedContext(a); assertCanonicalDistributedContext(b);
  if(!sameContext(a,b)) throw new Error(code);
}
export function prepareDistributedMutation(input:Omit<DistributedMutationEnvelope,'state'|'canonical_mutation_allowed'>):DistributedMutationEnvelope {
  assertCanonicalDistributedContext(input); return {...input,state:'prepared',canonical_mutation_allowed:false};
}
export function markAuthorityRechecked(env:DistributedMutationEnvelope, allowed:boolean, context:CanonicalDistributedContext=env):DistributedMutationEnvelope {
  assertSameContext(env,context,'authority-recheck-context-mismatch');
  return allowed?{...env,state:'authority_rechecked',canonical_mutation_allowed:false}:{...env,state:'denied',canonical_mutation_allowed:false};
}
export function acceptThroughCommandBus(env:DistributedMutationEnvelope, acceptance:CommandBusAcceptance):DistributedMutationEnvelope {
  assertSameContext(env,acceptance,'command-bus-context-mismatch');
  if(env.command_id!==acceptance.command_id) throw new Error('command-bus-command-mismatch');
  if(env.state!=='authority_rechecked'||!acceptance.accepted) throw new Error('command-bus-acceptance-required');
  return {...env,state:'command_bus_accepted',canonical_mutation_allowed:true};
}
export function markCanonicalMutation(env:DistributedMutationEnvelope):DistributedMutationEnvelope {
  assertCanonicalDistributedContext(env);
  if(env.state!=='command_bus_accepted'||!env.canonical_mutation_allowed) throw new Error('canonical-mutation-must-follow-command-bus');
  return {...env,state:'canonical_mutated'};
}
export function emitMutationSignal(env:DistributedMutationEnvelope, signal_id:string, created_at:string):{envelope:DistributedMutationEnvelope;signal:DistributedSignal} {
  assertCanonicalDistributedContext(env); if(env.state!=='canonical_mutated') throw new Error('signal-requires-canonical-mutation');
  const context={company_id:env.company_id,surface:env.surface,...(env.journey?{journey:env.journey}:{})};
  return {envelope:{...env,state:'signalled'},signal:{...context,signal_id,topic:'distributed.canonical_mutation.accepted',command_id:env.command_id,execution_id:env.execution_id,created_at}};
}
export function assureMutation(env:DistributedMutationEnvelope, command_receipt_ref:string, signal:DistributedSignal, evidence_id:string, created_at:string):{envelope:DistributedMutationEnvelope;evidence:AssuranceEvidence} {
  assertSameContext(env,signal,'assurance-context-mismatch');
  if(env.state!=='signalled'||env.execution_id!==signal.execution_id||env.command_id!==signal.command_id) throw new Error('assurance-requires-matching-signal');
  const context={company_id:env.company_id,surface:env.surface,...(env.journey?{journey:env.journey}:{})};
  return {envelope:{...env,state:'assured'},evidence:{...context,evidence_id,execution_id:env.execution_id,command_receipt_ref,signal_ref:signal.signal_id,verified:true,created_at}};
}
export function recoverOfflineCommandThroughCommandBus(command:OfflineCommand, env:DistributedMutationEnvelope, acceptance:CommandBusAcceptance):DistributedMutationEnvelope {
  assertCanonicalMutationReleased(command); assertSameContext(command,env,'offline-command-context-mismatch');
  if(command.command_id!==env.command_id) throw new Error('offline-command-envelope-mismatch');
  const checked=markAuthorityRechecked(env,true,command); return acceptThroughCommandBus(checked,acceptance);
}

export interface MutationCommitRecord extends CanonicalDistributedContext {
  mutation_id:string; command_id:string; execution_id:string; command_receipt_ref:string;
  signal_id:string; committed_at:string; mutation_hash:string;
}
export interface MutationCommitAttempt extends CanonicalDistributedContext {
  mutation_id:string; mutation_hash:string; command_receipt_ref:string; signal_id:string; committed_at:string;
}
/** In-memory contract model for adapters; durable implementations must persist the same uniqueness keys transactionally. */
export class MutationCommitLedger {
  private readonly byMutation=new Map<string,MutationCommitRecord>();
  private readonly byCommand=new Map<string,string>();
  commit(env:DistributedMutationEnvelope, attempt:MutationCommitAttempt):{record:MutationCommitRecord;duplicate:boolean} {
    assertSameContext(env,attempt,'mutation-commit-context-mismatch');
    if(env.state!=='canonical_mutated') throw new Error('mutation-commit-requires-canonical-mutation');
    if(!attempt.mutation_id||!attempt.mutation_hash||!attempt.command_receipt_ref||!attempt.signal_id) throw new Error('mutation-commit-identifiers-required');
    const companyKey=`${env.company_id}:${attempt.mutation_id}`;
    const commandKey=`${env.company_id}:${env.command_id}`;
    const existing=this.byMutation.get(companyKey);
    if(existing){
      if(existing.command_id!==env.command_id||existing.mutation_hash!==attempt.mutation_hash||existing.signal_id!==attempt.signal_id) throw new Error('mutation-replay-conflict');
      return {record:existing,duplicate:true};
    }
    const commandMutation=this.byCommand.get(commandKey);
    if(commandMutation && commandMutation!==attempt.mutation_id) throw new Error('command-replay-new-mutation-denied');
    const record:MutationCommitRecord={company_id:env.company_id,surface:env.surface,...(env.journey?{journey:env.journey}:{}),mutation_id:attempt.mutation_id,command_id:env.command_id,execution_id:env.execution_id,command_receipt_ref:attempt.command_receipt_ref,signal_id:attempt.signal_id,committed_at:attempt.committed_at,mutation_hash:attempt.mutation_hash};
    this.byMutation.set(companyKey,record); this.byCommand.set(commandKey,attempt.mutation_id); return {record,duplicate:false};
  }
}

export function signalFromCommittedMutation(env:DistributedMutationEnvelope, record:MutationCommitRecord):{envelope:DistributedMutationEnvelope;signal:DistributedSignal} {
  assertSameContext(env,record,'committed-signal-context-mismatch');
  if(env.command_id!==record.command_id||env.execution_id!==record.execution_id) throw new Error('committed-signal-correlation-mismatch');
  return emitMutationSignal(env,record.signal_id,record.committed_at);
}
