// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/recovery-approval-parameter-drift.mjs
const clean = v => String(v ?? '').trim();
const freeze = Object.freeze;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  }
  return value;
}
function diffPaths(a, b, prefix = '') {
  if (Object.is(a, b)) return [];
  const ao = a && typeof a === 'object';
  const bo = b && typeof b === 'object';
  if (!ao || !bo || Array.isArray(a) !== Array.isArray(b)) return [prefix || '$'];
  if (Array.isArray(a)) {
    const out = [];
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i += 1) out.push(...diffPaths(a[i], b[i], `${prefix}[${i}]`));
    return out;
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const out = [];
  for (const key of keys) out.push(...diffPaths(a[key], b[key], prefix ? `${prefix}.${key}` : key));
  return out;
}
export function inspectRecoveryApprovalParameterDrift({ company_id, approval_id, approved_parameters, execution_parameters } = {}) {
  const companyId = clean(company_id); if (!companyId) throw new Error('company_id-required');
  const missing = !(approved_parameters && typeof approved_parameters === 'object') || !(execution_parameters && typeof execution_parameters === 'object');
  const approved = missing ? null : canonical(approved_parameters);
  const execution = missing ? null : canonical(execution_parameters);
  const changed = missing ? [] : [...new Set(diffPaths(approved, execution))].sort();
  const drift = missing || changed.length > 0;
  return freeze({
    schema:'titan.reliability.recovery-approval-parameter-drift.v1', company_id:companyId, approval_id:clean(approval_id)||null,
    parameter_drift_detected:drift, safe_to_execute:!drift, changed_parameter_paths:freeze(changed),
    reason: missing ? 'recovery_approval_parameters_missing' : changed.length ? 'recovery_approval_parameter_drift' : null,
    advisory_only:true, grants_authority:false, changes_permissions:false, changes_autonomy:false, authority_effect:false,
  });
}
