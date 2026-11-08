export type ContinuitySurface = 'zero' | 'go' | 'hub';
export type ContinuationContext = { company_id: string; actor_id: string; task_id: string; conversation_id: string; run_id: string; correlation_id: string; authority_revision: number; surface: ContinuitySurface };
export type ContinuationDecision = { kind: 'CONTINUE'; context: ContinuationContext } | { kind: 'REJECT'; reason: 'COMPANY_MISMATCH' | 'STALE_AUTHORITY' | 'INVALID_SURFACE' };

export function continueTask(source: ContinuationContext, destination: { company_id: string; actor_id: string; authority_revision: number; surface: string }): ContinuationDecision {
  if (!['zero', 'go', 'hub'].includes(destination.surface)) return { kind: 'REJECT', reason: 'INVALID_SURFACE' };
  if (source.company_id !== destination.company_id || source.actor_id !== destination.actor_id) return { kind: 'REJECT', reason: 'COMPANY_MISMATCH' };
  if (source.authority_revision !== destination.authority_revision) return { kind: 'REJECT', reason: 'STALE_AUTHORITY' };
  return { kind: 'CONTINUE', context: { ...source, surface: destination.surface as ContinuitySurface } };
}

