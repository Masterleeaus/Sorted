// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/execution-environment-drift.mjs
const clean = v => String(v ?? '').trim();
const freeze = Object.freeze;
const FIELDS = ['runtime','policy','config'];
export function inspectExecutionEnvironmentDrift({ company_id, recovery_id, approved_environment = null, execution_environment = null } = {}) {
  const companyId = clean(company_id); if (!companyId) throw new Error('company_id-required');
  const changed = [];
  let missing = false;
  for (const field of FIELDS) {
    const approved = clean(approved_environment?.[field]);
    const executing = clean(execution_environment?.[field]);
    if (!approved || !executing) { missing = true; continue; }
    if (approved !== executing) changed.push(field);
  }
  const drift = missing || changed.length > 0;
  return freeze({
    schema:'titan.reliability.execution-environment-drift.v1', company_id:companyId, recovery_id:clean(recovery_id)||null,
    environment_drift_detected:drift, safe_to_execute:!drift, changed_environment_fields:freeze(changed.sort()),
    reason: missing ? 'execution_environment_fingerprint_missing' : changed.length ? 'execution_environment_drift' : null,
    advisory_only:true, grants_authority:false, changes_permissions:false, changes_autonomy:false, authority_effect:false,
  });
}
