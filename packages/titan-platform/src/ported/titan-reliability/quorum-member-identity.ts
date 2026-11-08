// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/quorum-member-identity.mjs
const clean = value => String(value ?? '').trim();
const freeze = Object.freeze;
const arr = value => Array.isArray(value) ? value : [];

export function inspectQuorumMemberIdentity({ company_id, observations = [] } = {}) {
  const companyId = clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const seen = new Map();
  const duplicates = new Set();
  const conflicts = new Set();
  let missingMemberCount = 0;
  for (const observation of arr(observations)) {
    const evidenceCompany = clean(observation?.company_id);
    if (evidenceCompany && evidenceCompany !== companyId) throw new Error('cross-company:quorum-member');
    const memberId = clean(observation?.member_id);
    if (!memberId) { missingMemberCount += 1; continue; }
    const stateHash = clean(observation?.state_hash);
    if (seen.has(memberId)) {
      duplicates.add(memberId);
      const prior = seen.get(memberId);
      if (prior && stateHash && prior !== stateHash) conflicts.add(memberId);
    } else {
      seen.set(memberId, stateHash || null);
    }
  }
  const duplicateIds = [...duplicates].sort();
  const conflictIds = [...conflicts].sort();
  const collision = duplicateIds.length > 0 || missingMemberCount > 0;
  return freeze({
    schema: 'titan.reliability.quorum-member-identity.v1',
    company_id: companyId,
    identity_collision_detected: collision,
    duplicate_member_ids: freeze(duplicateIds),
    conflicting_member_ids: freeze(conflictIds),
    missing_member_count: missingMemberCount,
    unique_member_count: seen.size,
    safe_to_count_quorum: !collision,
    deduplicates_votes: false,
    advisory_only: true,
    authority_effect: false,
    grants_authority: false,
    changes_permissions: false,
    changes_autonomy: false,
  });
}
