// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/startup-recovery.mjs
const clean = value => String(value ?? '').trim();
const arr = value => Array.isArray(value) ? value : [];

function assertCompany(companyId, value, source) {
  const id = clean(value);
  if (id && id !== companyId) throw new Error(`cross-company:${source}`);
}

export function buildStartupRecoveryPlan({ company_id, dependencies = [], circuits = [], pending_operations = [], now = Date.now() } = {}) {
  const companyId = clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  for (const dep of arr(dependencies)) assertCompany(companyId, dep?.company_id, `dependency:${dep?.dependency_id || 'unknown'}`);
  for (const circuit of arr(circuits)) assertCompany(companyId, circuit?.company_id, `circuit:${circuit?.dependency_id || 'unknown'}`);
  for (const op of arr(pending_operations)) assertCompany(companyId, op?.company_id, `operation:${op?.operation_id || 'unknown'}`);

  const unavailable = arr(dependencies).filter(dep => ['unavailable','unhealthy'].includes(clean(dep?.status).toLowerCase())).map(dep => clean(dep?.dependency_id)).filter(Boolean);
  const openCircuits = arr(circuits).filter(c => clean(c?.state).toLowerCase() === 'open').map(c => clean(c?.dependency_id)).filter(Boolean);
  const criticalBlocked = new Set([...unavailable, ...openCircuits]);
  const blocked = [];
  const preserveQueued = [];
  for (const op of arr(pending_operations)) {
    const id = clean(op?.operation_id || op?.id);
    const cls = clean(op?.operation_class || op?.class).toLowerCase();
    if (cls === 'authority_sensitive') {
      blocked.push(id);
      continue;
    }
    if (cls === 'durable_write' && op?.idempotent === true) preserveQueued.push(id);
  }

  const ready = criticalBlocked.size === 0 || blocked.length === 0;
  return Object.freeze({
    schema: 'titan.reliability.startup-recovery-plan.v1',
    company_id: companyId,
    company_boundary: 'company_id',
    generated_at: Number(now),
    ready,
    critical_dependency_ids: Object.freeze([...criticalBlocked].sort()),
    blocked_operation_ids: Object.freeze(blocked.filter(Boolean).sort()),
    preserve_queued_operation_ids: Object.freeze(preserveQueued.filter(Boolean).sort()),
    resume_authority_sensitive: false,
    auto_replay: false,
    requires_explicit_recovery_execution: true,
    authority_neutral: true,
    grants_authority: false,
    changes_permissions: false,
    changes_autonomy: false,
    authority_effect: false,
  });
}
