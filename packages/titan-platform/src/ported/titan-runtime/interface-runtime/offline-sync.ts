// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interface-runtime/offline-sync.mjs
const REQUIRED_QUEUE_FIELDS = Object.freeze([
  'queue_id','actor_id','company_id','device_id','capability','idempotency_key','queued_at','offline_policy'
]);
const PENDING_STATES = new Set(['pending','deferred','recovery']);

export function resolveOfflinePolicy(policy, online) {
  if (!policy) return 'online_required';
  const mode = policy.offline_policy ?? 'online_required';
  if (mode === 'allowed') return online ? 'execute_online' : 'queue_allowed';
  if (mode === 'deferred') return online ? 'execute_online' : 'queue_deferred';
  return online ? 'execute_online' : 'online_required';
}

export function createOfflineQueue() {
  const items = new Map();
  return Object.freeze({
    enqueue(input) {
      const item = { ...input };
      for (const field of REQUIRED_QUEUE_FIELDS) {
        if (item[field] === undefined || item[field] === null || item[field] === '') {
          throw new TypeError(`missing:${field}`);
        }
      }
      if (item.offline_policy === 'online_required') {
        throw new Error('online-required-capability-cannot-be-queued');
      }
      const key = `${item.company_id}|${item.actor_id}|${item.device_id}|${item.idempotency_key}`;
      if (items.has(key)) return items.get(key);
      const stored = Object.freeze({
        ...item,
        state: item.state ?? 'pending',
        attempts: item.attempts ?? 0,
        conflict_state: item.conflict_state ?? 'none',
      });
      items.set(key, stored);
      return stored;
    },
    pending() {
      return [...items.values()].filter((item) => PENDING_STATES.has(item.state));
    },
    all() {
      return [...items.values()];
    },
  });
}

export function planOfflineSync(items = []) {
  const ordered = [...items].sort((a, b) => {
    const aPriority = (a.kind ?? 'mutation') === 'evidence' ? 0 : 1;
    const bPriority = (b.kind ?? 'mutation') === 'evidence' ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return String(a.queued_at ?? '').localeCompare(String(b.queued_at ?? ''));
  });
  return Object.freeze({
    upload_phase: ordered,
    final_phase: 'authoritative_pull',
    rule: 'evidence_first_then_mutations_then_authoritative_pull',
  });
}

export function resolveOfflineConflict(item = {}, server = {}) {
  if (server.terminal === true && item.base_state_fingerprint !== (server.fingerprint ?? null)) {
    return Object.freeze({ state: 'conflict', conflict_state: 'terminal_server_state', options: ['use_server','review'] });
  }
  if (item.base_state_fingerprint != null && server.fingerprint != null && item.base_state_fingerprint !== server.fingerprint) {
    return Object.freeze({ state: 'conflict', conflict_state: 'server_changed', options: ['use_server','keep_local_as_new_change','review'] });
  }
  return Object.freeze({ state: 'syncing', conflict_state: 'none', options: [] });
}

export function validateOfflineReplay(item = {}, session = {}, capabilityDecision = {}) {
  const errors = [];
  if (item.company_id !== session.company_id) errors.push('company-mismatch');
  if (item.actor_id !== session.actor_id) errors.push('actor-mismatch');
  if (item.device_id !== session.device_id) errors.push('device-mismatch');
  if (capabilityDecision.allowed !== true) errors.push('capability-not-currently-allowed');
  if ((capabilityDecision.effective_autonomy ?? 0) > (capabilityDecision.online_effective_autonomy ?? 100)) {
    errors.push('offline-authority-increase-forbidden');
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
