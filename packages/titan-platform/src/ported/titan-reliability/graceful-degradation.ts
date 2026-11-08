// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/graceful-degradation.mjs
import { classifyDependencyHealth } from './dependency-health.js';

const OPERATION_CLASSES = new Set(['read_only','diagnostic','durable_write','authority_sensitive']);
const clean = value => String(value ?? '').trim();
const bool = value => value === true;
const freezeArray = value => Object.freeze([...value]);

export const DEFAULT_DEGRADATION_POLICY = Object.freeze({
  retry_after_ms: Object.freeze({ degraded: 1000, unhealthy: 5000, unavailable: 15000, unknown: 3000 }),
  allow_cached_read: true,
  allow_offline_queue_for_idempotent_write: true,
  allow_device_fallback_for_local_bridge: true,
  allow_byo_fallback_for_local_bridge: true,
  allow_network_cache_read: true,
});

function requireOperation(operation = {}) {
  const operationClass = clean(operation.operation_class || operation.class).toLowerCase();
  if (!OPERATION_CLASSES.has(operationClass)) throw new TypeError(`unsupported-operation-class:${operationClass || 'missing'}`);
  const companyId = clean(operation.company_id);
  if (!companyId) throw new Error('company_id-required');
  const correlationId = clean(operation.correlation_id || operation.operation_id || operation.id) || null;
  const operationId = clean(operation.operation_id || operation.id) || correlationId;
  return Object.freeze({
    operation_class: operationClass,
    company_id: companyId,
    correlation_id: correlationId,
    operation_id: operationId,
    idempotent: bool(operation.idempotent),
    cache_available: bool(operation.cache_available),
    offline_queue_available: bool(operation.offline_queue_available),
    device_fallback_available: bool(operation.device_fallback_available),
    byo_fallback_available: bool(operation.byo_fallback_available),
    sensitive: bool(operation.sensitive),
  });
}

function retryAfter(status, policy) {
  if (status === 'healthy') return 0;
  const value = Number(policy?.retry_after_ms?.[status]);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DEGRADATION_POLICY.retry_after_ms[status] ?? 3000;
}

function planActions(health, operation, policy) {
  if (health.status === 'healthy') return ['use_primary'];

  // Authority-sensitive work never silently changes execution paths.
  if (operation.operation_class === 'authority_sensitive') {
    return ['fail_closed','preserve_intent','surface_dependency_status','retry_primary'];
  }

  // Durable writes may use the existing durable offline queue only when the caller
  // explicitly declares idempotency and queue availability. They never degrade to
  // memory-only/cache writes.
  if (operation.operation_class === 'durable_write') {
    if (health.dependency_kind === 'network' && operation.idempotent && operation.offline_queue_available && policy.allow_offline_queue_for_idempotent_write !== false) {
      return ['queue_durable_offline','preserve_idempotency','surface_dependency_status'];
    }
    return ['fail_closed','preserve_intent','surface_dependency_status','retry_primary'];
  }

  if (health.dependency_kind === 'storage') {
    if (operation.cache_available && policy.allow_cached_read !== false) return ['read_verified_cache','mark_stale_possible','surface_dependency_status'];
    return ['return_unavailable','surface_dependency_status','retry_primary'];
  }

  if (health.dependency_kind === 'network') {
    if (operation.cache_available && policy.allow_network_cache_read !== false) return ['read_verified_cache','mark_stale_possible','surface_dependency_status'];
    return ['offline_read_mode','surface_dependency_status','retry_primary'];
  }

  if (health.dependency_kind === 'local_bridge') {
    const actions = [];
    if (operation.device_fallback_available && policy.allow_device_fallback_for_local_bridge !== false) actions.push('use_device_fallback');
    if (!operation.sensitive && operation.byo_fallback_available && policy.allow_byo_fallback_for_local_bridge !== false) actions.push('use_byo_fallback');
    if (!actions.length) actions.push('return_unavailable');
    actions.push('surface_dependency_status');
    return actions;
  }

  if (health.dependency_kind === 'browser') {
    return ['preserve_ui_state','reload_surface_or_retry','surface_dependency_status'];
  }

  return ['return_unavailable','surface_dependency_status'];
}

export function planGracefulDegradation({ dependency, operation, policy = DEFAULT_DEGRADATION_POLICY, now = Date.now() } = {}) {
  const op = requireOperation(operation);
  const health = dependency?.schema === 'titan.reliability.dependency-health.v1'
    ? dependency
    : classifyDependencyHealth(dependency || {}, { now });

  if (health.company_id && health.company_id !== op.company_id) throw new Error('cross-company:dependency-health');
  const actions = freezeArray(planActions(health, op, policy));
  const degraded = health.status !== 'healthy';
  const failClosed = actions.includes('fail_closed');
  const queuedOffline = actions.includes('queue_durable_offline');

  return Object.freeze({
    schema: 'titan.reliability.graceful-degradation-plan.v1',
    company_id: op.company_id,
    company_boundary: 'company_id',
    correlation_id: op.correlation_id,
    operation_id: op.operation_id,
    operation_class: op.operation_class,
    dependency_id: health.dependency_id,
    dependency_kind: health.dependency_kind,
    dependency_status: health.status,
    dependency_reason_code: health.reason_code,
    degraded,
    actions,
    retry_after_ms: retryAfter(health.status, policy),
    fail_closed: failClosed,
    durable_offline_queue_permitted: queuedOffline,
    requires_idempotency: queuedOffline,
    authority_neutral: true,
    grants_authority: false,
    changes_permissions: false,
    changes_autonomy: false,
    silent_fallback: false,
  });
}

export function createDegradationEnvelope(plan, payload = {}) {
  if (!plan || plan.schema !== 'titan.reliability.graceful-degradation-plan.v1') throw new TypeError('degradation-plan-required');
  const payloadCompany = clean(payload.company_id);
  if (payloadCompany && payloadCompany !== plan.company_id) throw new Error('cross-company:degradation-payload');
  return Object.freeze({
    schema: 'titan.reliability.degradation-envelope.v1',
    company_id: plan.company_id,
    company_boundary: 'company_id',
    correlation_id: plan.correlation_id,
    operation_id: plan.operation_id,
    dependency_id: plan.dependency_id,
    dependency_kind: plan.dependency_kind,
    dependency_status: plan.dependency_status,
    actions: plan.actions,
    retry_after_ms: plan.retry_after_ms,
    payload: Object.freeze({ ...payload, company_id: plan.company_id }),
    authority_neutral: true,
    grants_authority: false,
  });
}

export const gracefulDegradationOperationClasses = Object.freeze([...OPERATION_CLASSES]);
