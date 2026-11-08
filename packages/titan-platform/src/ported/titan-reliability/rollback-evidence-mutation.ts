// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/rollback-evidence-mutation.mjs
const clean = v => String(v ?? '').trim();
const arr = v => Array.isArray(v) ? v : [];
const freeze = Object.freeze;
function normalize(items) {
  const map = new Map();
  const duplicates = [];
  const invalid = [];
  for (const item of arr(items)) {
    const id = clean(item?.id); const hash = clean(item?.hash);
    if (!id || !hash) { invalid.push(id || '(missing)'); continue; }
    if (map.has(id)) duplicates.push(id); else map.set(id, hash);
  }
  return { map, duplicates:[...new Set(duplicates)].sort(), invalid };
}
export function inspectRollbackEvidenceMutation({ company_id, rollback_id, approved_evidence = [], execution_evidence = [] } = {}) {
  const companyId = clean(company_id); if (!companyId) throw new Error('company_id-required');
  const approved = normalize(approved_evidence); const execution = normalize(execution_evidence);
  const added = [...execution.map.keys()].filter(id => !approved.map.has(id)).sort();
  const removed = [...approved.map.keys()].filter(id => !execution.map.has(id)).sort();
  const changed = [...approved.map.keys()].filter(id => execution.map.has(id) && approved.map.get(id) !== execution.map.get(id)).sort();
  const mutation = added.length || removed.length || changed.length || approved.duplicates.length || execution.duplicates.length || approved.invalid.length || execution.invalid.length;
  return freeze({
    schema:'titan.reliability.rollback-evidence-mutation.v1', company_id:companyId, rollback_id:clean(rollback_id)||null,
    mutation_detected:Boolean(mutation), safe_to_rollback:!mutation,
    added_evidence_ids:freeze(added), removed_evidence_ids:freeze(removed), changed_evidence_ids:freeze(changed),
    duplicate_approved_evidence_ids:freeze(approved.duplicates), duplicate_execution_evidence_ids:freeze(execution.duplicates),
    reason: mutation ? 'rollback_evidence_set_mutated' : null,
    advisory_only:true, grants_authority:false, changes_permissions:false, changes_autonomy:false, authority_effect:false,
  });
}
