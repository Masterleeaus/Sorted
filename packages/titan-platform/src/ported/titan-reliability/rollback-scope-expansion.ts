// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/rollback-scope-expansion.mjs
const clean = value => String(value ?? '').trim();
const freeze = Object.freeze;
const normalizeIds = value => Array.isArray(value)
  ? [...new Set(value.map(clean).filter(Boolean))].sort()
  : null;

export function evaluateRollbackScopeExpansion({
  company_id,
  evidence_company_id = null,
  rollback_id = null,
  authorized_target_ids = null,
  proposed_target_ids = null,
} = {}) {
  const companyId = clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const evidenceCompany = clean(evidence_company_id);
  if (evidenceCompany && evidenceCompany !== companyId) throw new Error('cross-company:rollback-scope-expansion');

  const authorized = normalizeIds(authorized_target_ids);
  const proposed = normalizeIds(proposed_target_ids);
  const verifiable = authorized !== null && proposed !== null;
  const allowed = new Set(authorized || []);
  const unauthorized = verifiable ? proposed.filter(id => !allowed.has(id)) : [];
  const expanded = verifiable && unauthorized.length > 0;
  const safe = verifiable && !expanded;

  return freeze({
    schema: 'titan.reliability.rollback-scope-expansion.v1',
    company_id: companyId,
    rollback_id: clean(rollback_id) || null,
    verifiable,
    scope_expanded: expanded,
    authorized_target_ids: freeze(authorized || []),
    proposed_target_ids: freeze(proposed || []),
    unauthorized_target_ids: freeze(unauthorized),
    safe_to_rollback: safe,
    reason: safe ? null : (!verifiable ? 'rollback_scope_unverifiable' : 'rollback_scope_expanded_beyond_authority'),
    auto_expand_scope: false,
    auto_rollback: false,
    advisory_only: true,
    authority_effect: false,
    grants_authority: false,
    changes_permissions: false,
    changes_autonomy: false,
  });
}
