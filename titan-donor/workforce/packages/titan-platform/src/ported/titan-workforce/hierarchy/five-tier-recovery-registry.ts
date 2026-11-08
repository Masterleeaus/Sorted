// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/hierarchy/five-tier-recovery-registry.mjs
import registry from './five-tier-recovery-registry.json' with { type: 'json' };
export { registry };
export const atomicWorkers = registry.legacy_recovery.tier3_atomic_worker_candidates;
export const specialists = registry.legacy_recovery.tier2_specialist_assistants;
export const safeManagerCandidates = registry.legacy_recovery.safe_manager_candidates;
export function findAtomicWorker(id){ return atomicWorkers.find(x=>x.id===id) ?? null; }
