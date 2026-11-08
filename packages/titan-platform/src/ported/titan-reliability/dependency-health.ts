// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/dependency-health.mjs
const DEPENDENCY_KINDS = new Set(['browser','storage','local_bridge','network']);
const STATUSES = new Set(['healthy','degraded','unhealthy','unavailable','unknown']);
const clean = value => String(value ?? '').trim();
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const bool = value => typeof value === 'boolean' ? value : null;

export const DEFAULT_DEPENDENCY_HEALTH_POLICY = Object.freeze({
  failure_threshold_degraded: 1,
  failure_threshold_unhealthy: 3,
  latency_degraded_ms: 1500,
  latency_unhealthy_ms: 5000,
  stale_degraded_ms: 30000,
  stale_unavailable_ms: 120000,
});

function policyValue(policy, key) {
  const value = finite(policy?.[key]);
  return value != null && value >= 0 ? value : DEFAULT_DEPENDENCY_HEALTH_POLICY[key];
}

function normalizedStatus(value) {
  const status = clean(value).toLowerCase();
  if (STATUSES.has(status)) return status;
  if (['ok','ready','available','online','active'].includes(status)) return 'healthy';
  if (['warn','warning','partial','slow'].includes(status)) return 'degraded';
  if (['error','failed','failure','down'].includes(status)) return 'unhealthy';
  if (['missing','offline','disconnected'].includes(status)) return 'unavailable';
  return null;
}

function retryHint(status, kind) {
  if (status === 'healthy') return 'none';
  if (status === 'degraded') return kind === 'storage' ? 'retry_with_backoff' : 'retry_or_fallback';
  if (status === 'unhealthy') return kind === 'browser' ? 'reload_surface_or_retry' : 'fallback_or_retry_with_backoff';
  if (status === 'unavailable') return kind === 'local_bridge' ? 'use_device_or_byo_fallback' : 'wait_for_dependency_or_fallback';
  return 'probe_again';
}

function classifyReason({ explicit, available, ok, failures, latency, stale, error }, thresholds) {
  if (available === false) return ['unavailable','dependency_reported_unavailable'];
  if (stale != null && stale >= thresholds.stale_unavailable_ms) return ['unavailable','observation_stale'];
  if (explicit === 'unavailable') return ['unavailable','explicit_unavailable'];
  if (failures >= thresholds.failure_threshold_unhealthy) return ['unhealthy','repeated_failures'];
  if (latency != null && latency >= thresholds.latency_unhealthy_ms) return ['unhealthy','latency_critical'];
  if (explicit === 'unhealthy' || ok === false || error) return ['unhealthy', error ? 'dependency_error' : 'dependency_failed'];
  if (explicit === 'degraded') return ['degraded','explicit_degraded'];
  if (failures >= thresholds.failure_threshold_degraded) return ['degraded','recent_failure'];
  if (latency != null && latency >= thresholds.latency_degraded_ms) return ['degraded','latency_elevated'];
  if (stale != null && stale >= thresholds.stale_degraded_ms) return ['degraded','observation_aging'];
  if (explicit === 'healthy' || ok === true || available === true) return ['healthy','dependency_responding'];
  return ['unknown','insufficient_evidence'];
}

export function classifyDependencyHealth(observation = {}, { policy = DEFAULT_DEPENDENCY_HEALTH_POLICY, now = Date.now() } = {}) {
  const kind = clean(observation.kind || observation.dependency_kind).toLowerCase();
  if (!DEPENDENCY_KINDS.has(kind)) throw new TypeError(`unsupported-dependency-kind:${kind || 'missing'}`);
  const dependencyId = clean(observation.dependency_id || observation.id || kind);
  const companyId = clean(observation.company_id) || null;
  const observedAt = finite(observation.observed_at);
  const staleFromClock = observedAt != null ? Math.max(0, Number(now) - observedAt) : null;
  const stale = finite(observation.stale_ms) ?? staleFromClock;
  const failures = Math.max(0, Math.floor(finite(observation.consecutive_failures) ?? 0));
  const latency = finite(observation.latency_ms);
  const explicit = normalizedStatus(observation.status);
  const available = bool(observation.available);
  const ok = bool(observation.ok);
  const error = clean(observation.error) || null;
  const thresholds = Object.freeze({
    failure_threshold_degraded: policyValue(policy,'failure_threshold_degraded'),
    failure_threshold_unhealthy: policyValue(policy,'failure_threshold_unhealthy'),
    latency_degraded_ms: policyValue(policy,'latency_degraded_ms'),
    latency_unhealthy_ms: policyValue(policy,'latency_unhealthy_ms'),
    stale_degraded_ms: policyValue(policy,'stale_degraded_ms'),
    stale_unavailable_ms: policyValue(policy,'stale_unavailable_ms'),
  });
  const [status, reasonCode] = classifyReason({ explicit, available, ok, failures, latency, stale, error }, thresholds);
  return Object.freeze({
    schema: 'titan.reliability.dependency-health.v1',
    dependency_id: dependencyId,
    dependency_kind: kind,
    company_id: companyId,
    company_boundary: 'company_id',
    status,
    reason_code: reasonCode,
    available: status !== 'unavailable',
    usable: status === 'healthy' || status === 'degraded',
    latency_ms: latency,
    stale_ms: stale,
    consecutive_failures: failures,
    error,
    retry_hint: retryHint(status, kind),
    thresholds,
    observed_at: observedAt,
    classified_at: Number(now),
    non_authoritative: true,
    grants_authority: false,
    authority_effect: false,
  });
}

export function classifyDependencySet(observations = [], options = {}) {
  if (!Array.isArray(observations)) throw new TypeError('dependency-observations-array-required');
  const items = observations.map(observation => classifyDependencyHealth(observation, options));
  const byId = Object.freeze(Object.fromEntries(items.map(item => [item.dependency_id, item])));
  const counts = Object.freeze(items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, { healthy: 0, degraded: 0, unhealthy: 0, unavailable: 0, unknown: 0 }));
  const companyIds = [...new Set(items.map(item => item.company_id).filter(Boolean))];
  const status = counts.unhealthy || counts.unavailable ? 'unhealthy' : counts.degraded || counts.unknown ? 'degraded' : 'healthy';
  return Object.freeze({
    schema: 'titan.reliability.dependency-health-set.v1',
    company_id: companyIds.length === 1 ? companyIds[0] : null,
    company_boundary: 'company_id',
    mixed_company_input: companyIds.length > 1,
    status,
    counts,
    dependencies: byId,
    non_authoritative: true,
    grants_authority: false,
    authority_effect: false,
  });
}

export const dependencyHealthKinds = Object.freeze([...DEPENDENCY_KINDS]);
