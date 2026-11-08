// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/circuit-breaker.mjs
const clean = value => String(value ?? '').trim();
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function freezeState(state) {
  return Object.freeze({
    schema: 'titan.reliability.circuit-breaker-state.v1',
    company_id: state.company_id,
    company_boundary: 'company_id',
    dependency_id: state.dependency_id,
    state: state.state,
    failure_threshold: state.failure_threshold,
    reset_timeout_ms: state.reset_timeout_ms,
    consecutive_failures: state.consecutive_failures,
    opened_at: state.opened_at,
    last_attempt_at: state.last_attempt_at,
    last_success_at: state.last_success_at,
    last_failure_at: state.last_failure_at,
    authority_neutral: true,
    grants_authority: false,
    changes_permissions: false,
    changes_autonomy: false,
    authority_effect: false,
  });
}

function requireState(state) {
  if (!state || state.schema !== 'titan.reliability.circuit-breaker-state.v1') throw new TypeError('circuit-breaker-state-required');
  return state;
}

export function createCircuitBreakerState({ company_id, dependency_id, failure_threshold = 3, reset_timeout_ms = 30000, now = Date.now() } = {}) {
  const companyId = clean(company_id);
  const dependencyId = clean(dependency_id);
  if (!companyId) throw new Error('company_id-required');
  if (!dependencyId) throw new Error('dependency_id-required');
  return freezeState({
    company_id: companyId,
    dependency_id: dependencyId,
    state: 'closed',
    failure_threshold: Math.max(1, Math.floor(finite(failure_threshold, 3))),
    reset_timeout_ms: Math.max(0, finite(reset_timeout_ms, 30000)),
    consecutive_failures: 0,
    opened_at: null,
    last_attempt_at: Number(now),
    last_success_at: null,
    last_failure_at: null,
  });
}

export function canAttemptCircuit(state, { company_id, now = Date.now() } = {}) {
  const current = requireState(state);
  const requestedCompany = clean(company_id);
  if (requestedCompany && requestedCompany !== current.company_id) throw new Error('cross-company:circuit-breaker');
  const currentTime = Number(now);
  if (current.state === 'open') {
    const elapsed = current.opened_at == null ? 0 : Math.max(0, currentTime - current.opened_at);
    if (elapsed >= current.reset_timeout_ms) {
      const nextState = freezeState({ ...current, state: 'half_open', last_attempt_at: currentTime });
      return Object.freeze({ allowed: true, state: 'half_open', reason: 'reset_timeout_elapsed', next_state: nextState });
    }
    return Object.freeze({ allowed: false, state: 'open', reason: 'circuit_open', retry_after_ms: Math.max(0, current.reset_timeout_ms - elapsed), next_state: current });
  }
  return Object.freeze({ allowed: true, state: current.state, reason: current.state === 'half_open' ? 'probe_allowed' : 'circuit_closed', next_state: freezeState({ ...current, last_attempt_at: currentTime }) });
}

export function recordCircuitResult(state, { ok, company_id, now = Date.now() } = {}) {
  const current = requireState(state);
  const requestedCompany = clean(company_id);
  if (requestedCompany && requestedCompany !== current.company_id) throw new Error('cross-company:circuit-breaker');
  if (typeof ok !== 'boolean') throw new TypeError('circuit-result-ok-boolean-required');
  const currentTime = Number(now);
  if (ok) {
    return freezeState({
      ...current,
      state: 'closed',
      consecutive_failures: 0,
      opened_at: null,
      last_attempt_at: currentTime,
      last_success_at: currentTime,
    });
  }
  const failures = current.consecutive_failures + 1;
  const open = current.state === 'half_open' || failures >= current.failure_threshold;
  return freezeState({
    ...current,
    state: open ? 'open' : 'closed',
    consecutive_failures: failures,
    opened_at: open ? currentTime : current.opened_at,
    last_attempt_at: currentTime,
    last_failure_at: currentTime,
  });
}
