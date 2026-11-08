// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/recovery-state-drift.mjs
const clean=v=>String(v??'').trim();
const freeze=v=>Object.freeze(v);
export function evaluateRecoveryStateDrift({company_id,operation_id=null,expected_revision,observed_revision,expected_checkpoint_id=null,observed_checkpoint_id=null}={}){
  const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
  const expected=Number(expected_revision), observed=Number(observed_revision);
  const expectedCheckpoint=clean(expected_checkpoint_id)||null, observedCheckpoint=clean(observed_checkpoint_id)||null;
  const revisionComparable=Number.isFinite(expected)&&Number.isFinite(observed);
  const revisionMismatch=!revisionComparable || expected!==observed;
  const checkpointMismatch=expectedCheckpoint!==observedCheckpoint;
  const drift=revisionMismatch||checkpointMismatch;
  return freeze({
    schema:'titan.reliability.recovery-state-drift.v1', company_id:companyId,
    operation_id:clean(operation_id)||null,
    expected_revision:Number.isFinite(expected)?expected:null, observed_revision:Number.isFinite(observed)?observed:null,
    expected_checkpoint_id:expectedCheckpoint, observed_checkpoint_id:observedCheckpoint,
    revision_mismatch:revisionMismatch, checkpoint_mismatch:checkpointMismatch,
    drift_detected:drift, safe_to_resume:!drift, reason:drift?'recovery_state_drift':'recovery_state_matches',
    rewrites_state:false, auto_replay:false, grants_authority:false, changes_permissions:false, changes_autonomy:false, authority_effect:false,
  });
}
