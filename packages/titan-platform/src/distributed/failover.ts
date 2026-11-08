import type { CanonicalDistributedContext } from './context.js';
import { assertCanonicalDistributedContext } from './context.js';

/** Reconnect/failover must rebind current company, authority and placement state. */
export interface DistributedReplayEnvelope extends CanonicalDistributedContext {
  operation_id: string;
  idempotency_key: string;
  authority_revision: number;
  placement_revision: number;
  source_node_id: string;
  target_node_id: string;
}

export interface CurrentDistributedState {
  company_id: string;
  authority_revision: number;
  placement_revision: number;
  node_enabled: boolean;
  target_node_id: string;
}

export type ReplayDecision =
  | { kind: 'REPLAY'; envelope: DistributedReplayEnvelope; reason: 'RECONNECT' | 'FAILOVER' }
  | { kind: 'REJECT'; reason: 'COMPANY_MISMATCH' | 'STALE_AUTHORITY' | 'STALE_PLACEMENT' | 'TARGET_DISABLED' | 'TARGET_MISMATCH' };

function required(value: string, name: string): void {
  if (!value.trim()) throw new Error(`distributed_${name}_required`);
}

export function revalidateDistributedReplay(
  envelope: DistributedReplayEnvelope,
  current: CurrentDistributedState,
  reason: 'RECONNECT' | 'FAILOVER',
): ReplayDecision {
  assertCanonicalDistributedContext(envelope);
  required(envelope.operation_id, 'operation_id');
  required(envelope.idempotency_key, 'idempotency_key');
  if (envelope.company_id !== current.company_id) return { kind: 'REJECT', reason: 'COMPANY_MISMATCH' };
  if (envelope.authority_revision !== current.authority_revision) return { kind: 'REJECT', reason: 'STALE_AUTHORITY' };
  if (envelope.placement_revision !== current.placement_revision) return { kind: 'REJECT', reason: 'STALE_PLACEMENT' };
  if (!current.node_enabled) return { kind: 'REJECT', reason: 'TARGET_DISABLED' };
  if (envelope.target_node_id !== current.target_node_id) return { kind: 'REJECT', reason: 'TARGET_MISMATCH' };
  return { kind: 'REPLAY', envelope, reason };
}

