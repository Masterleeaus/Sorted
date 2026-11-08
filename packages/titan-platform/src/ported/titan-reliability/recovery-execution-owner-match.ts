// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/recovery-execution-owner-match.mjs
const clean = v => String(v ?? '').trim();
const freeze = Object.freeze;
export function inspectRecoveryExecutionOwnerMatch({ company_id, recovery_id, approved_owner_id, executing_actor_id } = {}) {
  const companyId = clean(company_id); if (!companyId) throw new Error('company_id-required');
  const approved = clean(approved_owner_id); const executing = clean(executing_actor_id);
  const malformed = !approved || !executing;
  const mismatch = !malformed && approved !== executing;
  return freeze({
    schema:'titan.reliability.recovery-execution-owner-match.v1', company_id:companyId, recovery_id:clean(recovery_id)||null,
    approved_owner_id:approved||null, executing_actor_id:executing||null,
    owner_mismatch_detected:mismatch || malformed, safe_to_execute:!(mismatch || malformed),
    reason: malformed ? 'recovery_execution_owner_missing' : mismatch ? 'recovery_execution_owner_mismatch' : null,
    advisory_only:true, grants_authority:false, changes_permissions:false, changes_autonomy:false, authority_effect:false,
  });
}
