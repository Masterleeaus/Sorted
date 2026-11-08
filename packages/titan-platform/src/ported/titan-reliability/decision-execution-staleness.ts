// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/decision-execution-staleness.mjs
const clean = value => String(value ?? '').trim();
const freeze = Object.freeze;

export function evaluateDecisionExecutionStaleness({
  company_id,
  evidence_company_id = null,
  decision_id = null,
  decided_at_ms = null,
  execution_at_ms = Date.now(),
  max_age_ms = 30000,
} = {}) {
  const companyId = clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const evidenceCompany = clean(evidence_company_id);
  if (evidenceCompany && evidenceCompany !== companyId) throw new Error('cross-company:decision-execution-staleness');

  const decidedAt = Number(decided_at_ms);
  const executionAt = Number(execution_at_ms);
  const maxAge = Number(max_age_ms);
  const verifiable = Number.isFinite(decidedAt) && Number.isFinite(executionAt) && Number.isFinite(maxAge) && maxAge >= 0;
  const futureDecision = verifiable && decidedAt > executionAt;
  const ageMs = verifiable ? Math.max(0, executionAt - decidedAt) : null;
  const stale = verifiable && !futureDecision && ageMs > maxAge;
  const safe = verifiable && !futureDecision && !stale;

  return freeze({
    schema: 'titan.reliability.decision-execution-staleness.v1',
    company_id: companyId,
    decision_id: clean(decision_id) || null,
    verifiable,
    stale,
    future_decision_timestamp: futureDecision,
    age_ms: ageMs,
    max_age_ms: verifiable ? maxAge : null,
    safe_to_execute: safe,
    reason: safe ? null : (!verifiable ? 'decision_execution_window_unverifiable' : futureDecision ? 'decision_timestamp_in_future' : 'decision_execution_window_expired'),
    auto_refresh: false,
    auto_execute: false,
    advisory_only: true,
    authority_effect: false,
    grants_authority: false,
    changes_permissions: false,
    changes_autonomy: false,
  });
}
