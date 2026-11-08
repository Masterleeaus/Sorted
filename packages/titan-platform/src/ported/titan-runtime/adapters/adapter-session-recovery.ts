// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/adapters/adapter-session-recovery.mjs
export const ADAPTER_SESSION_SCHEMA = 'titan-zero-adapter-session/v1';
export const ADAPTER_SESSION_RECOVERY_SCHEMA = 'titan-zero-adapter-session-recovery/v1';

const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

function rejectLegacy(input) {
  if (!input || typeof input !== 'object') return;
  if ('tenant_id' in input || 'tenant_company_id' in input) {
    throw new TypeError('legacy tenant boundaries are not accepted');
  }
}

function requireCompanyId(input) {
  rejectLegacy(input);
  const company_id = clean(input?.company_id);
  if (!company_id) throw new TypeError('canonical company_id is required');
  return company_id;
}

function finite(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function createAdapterSession(input = {}) {
  const company_id = requireCompanyId(input);
  const session_id = clean(input.session_id);
  const runtime = clean(input.runtime);
  const adapter_version = clean(input.adapter_version);
  const correlation_id = clean(input.correlation_id);
  const work_id = clean(input.work_id);
  const navigation_key = clean(input.navigation_key);
  if (!session_id || !runtime || !adapter_version || !correlation_id || !navigation_key) {
    throw new TypeError('session_id, runtime, adapter_version, correlation_id and navigation_key are required');
  }

  const created_at = finite(input.created_at, Date.now());
  const last_seen_at = finite(input.last_seen_at, created_at);
  const epoch = Number.isInteger(input.epoch) && input.epoch >= 0 ? input.epoch : 0;

  return Object.freeze({
    schema: ADAPTER_SESSION_SCHEMA,
    session_id,
    company_id,
    runtime,
    adapter_version,
    correlation_id,
    work_id,
    navigation_key,
    epoch,
    created_at,
    last_seen_at,
    resumable: input.resumable !== false,
    authority_snapshot_ref: clean(input.authority_snapshot_ref),
    adapter_granted_authority: false,
    execution_authority: false
  });
}

export function classifyAdapterSession(session, current = {}) {
  if (!session || session.schema !== ADAPTER_SESSION_SCHEMA) {
    throw new TypeError('valid adapter session is required');
  }
  rejectLegacy(current);
  const company_id = requireCompanyId(current);

  if (company_id !== session.company_id) {
    return Object.freeze({
      status: 'company_mismatch',
      recoverable: false,
      reason: 'company_id_changed',
      grants_authority: false,
      execution_authority: false
    });
  }

  const navigation_key = clean(current.navigation_key);
  if (!navigation_key) throw new TypeError('navigation_key is required');

  const now = finite(current.now, Date.now());
  const stale_after_ms = Math.max(1, finite(current.stale_after_ms, 30000));
  const adapter_version = clean(current.adapter_version);
  const runtime = clean(current.runtime);

  if (runtime && runtime !== session.runtime) {
    return Object.freeze({
      status: 'runtime_changed',
      recoverable: false,
      reason: 'runtime_identity_changed',
      grants_authority: false,
      execution_authority: false
    });
  }

  if (adapter_version && adapter_version !== session.adapter_version) {
    return Object.freeze({
      status: 'version_changed',
      recoverable: false,
      reason: 'adapter_version_changed',
      grants_authority: false,
      execution_authority: false
    });
  }

  const age_ms = Math.max(0, now - session.last_seen_at);
  const navigation_changed = navigation_key !== session.navigation_key;
  const stale = age_ms >= stale_after_ms;

  if (!navigation_changed && !stale) {
    return Object.freeze({
      status: 'current',
      recoverable: true,
      reason: null,
      age_ms,
      navigation_changed: false,
      grants_authority: false,
      execution_authority: false
    });
  }

  if (session.resumable !== true) {
    return Object.freeze({
      status: stale ? 'stale_non_resumable' : 'navigation_non_resumable',
      recoverable: false,
      reason: stale ? 'stale_session_not_resumable' : 'navigation_changed_session_not_resumable',
      age_ms,
      navigation_changed,
      grants_authority: false,
      execution_authority: false
    });
  }

  return Object.freeze({
    status: stale ? 'stale_resumable' : 'navigation_resumable',
    recoverable: true,
    reason: stale ? 'session_stale' : 'navigation_changed',
    age_ms,
    navigation_changed,
    grants_authority: false,
    execution_authority: false
  });
}

export function recoverAdapterSession(session, current = {}) {
  const classification = classifyAdapterSession(session, current);
  const company_id = requireCompanyId(current);

  if (!classification.recoverable) {
    return Object.freeze({
      schema: ADAPTER_SESSION_RECOVERY_SCHEMA,
      recovered: false,
      company_id,
      previous_session_id: session.session_id,
      recovery_status: classification.status,
      reason: classification.reason,
      requires_new_negotiation: true,
      requires_fresh_authority_evaluation: true,
      grants_authority: false,
      execution_authority: false
    });
  }

  const navigation_key = clean(current.navigation_key);
  const now = finite(current.now, Date.now());
  const changed = classification.status !== 'current';

  return Object.freeze({
    schema: ADAPTER_SESSION_RECOVERY_SCHEMA,
    recovered: true,
    company_id,
    session: createAdapterSession({
      ...session,
      company_id,
      navigation_key,
      epoch: changed ? session.epoch + 1 : session.epoch,
      last_seen_at: now,
      authority_snapshot_ref: changed ? null : session.authority_snapshot_ref
    }),
    recovery_status: classification.status,
    reason: classification.reason,
    requires_new_negotiation: changed,
    requires_fresh_authority_evaluation: changed,
    grants_authority: false,
    execution_authority: false
  });
}

export function createReconnectPlan(input = {}) {
  const company_id = requireCompanyId(input);
  const trigger = clean(input.trigger);
  const recovery = input.recovery;
  if (!trigger || !['navigation','reload','restart','transport_disconnect'].includes(trigger)) {
    throw new TypeError('valid reconnect trigger is required');
  }
  if (!recovery || recovery.schema !== ADAPTER_SESSION_RECOVERY_SCHEMA) {
    throw new TypeError('valid recovery result is required');
  }
  if (recovery.company_id !== company_id) {
    throw new TypeError('recovery company_id must match reconnect company_id');
  }

  const actions = [];
  if (recovery.recovered && recovery.requires_new_negotiation) {
    actions.push('renegotiate_adapter');
  }
  if (recovery.recovered && recovery.requires_fresh_authority_evaluation) {
    actions.push('reevaluate_execution_authority');
  }
  if (!recovery.recovered) {
    actions.push('discard_stale_session','create_new_session','renegotiate_adapter','reevaluate_execution_authority');
  }
  if (recovery.recovered && !recovery.requires_new_negotiation) {
    actions.push('resume_existing_session');
  }

  return Object.freeze({
    schema: 'titan-zero-adapter-reconnect-plan/v1',
    trigger,
    company_id,
    actions: Object.freeze(actions),
    auto_execute_after_reconnect: false,
    prior_authority_reused_after_boundary_change: false,
    adapter_granted_authority: false,
    execution_authority: false
  });
}
