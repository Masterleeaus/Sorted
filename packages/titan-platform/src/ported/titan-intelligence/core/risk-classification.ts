// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/risk-classification.mjs
export const RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'exceptional']);

const WEIGHTS = Object.freeze({
  cross_domain: 12,
  external_propagation: 14,
  personal_or_sensitive_data: 18,
  privileged_change: 24,
  destructive_change: 28,
  irreversible_change: 30,
  legal_or_regulatory_effect: 24,
  safety_consequence: 30,
  material_financial_effect: 22,
  provenance_gap: 14,
  evidence_conflict: 16,
  uncertainty_high: 14,
  multiple_people_affected: 8,
  public_or_customer_facing: 8
});

function bool(v) { return v === true; }
function finiteNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function normaliseEvidence(input = {}) {
  return {
    cross_domain: bool(input.cross_domain),
    external_propagation: bool(input.external_propagation),
    personal_or_sensitive_data: bool(input.personal_or_sensitive_data),
    privileged_change: bool(input.privileged_change),
    destructive_change: bool(input.destructive_change),
    irreversible_change: bool(input.irreversible_change),
    legal_or_regulatory_effect: bool(input.legal_or_regulatory_effect),
    safety_consequence: bool(input.safety_consequence),
    material_financial_effect: bool(input.material_financial_effect),
    provenance_gap: bool(input.provenance_gap),
    evidence_conflict: bool(input.evidence_conflict),
    uncertainty_high: bool(input.uncertainty_high),
    multiple_people_affected: bool(input.multiple_people_affected),
    public_or_customer_facing: bool(input.public_or_customer_facing),
    financial_amount: Math.max(0, finiteNumber(input.financial_amount)),
    catastrophic_consequence_possible: bool(input.catastrophic_consequence_possible),
    cross_company_boundary_attempt: bool(input.cross_company_boundary_attempt),
    sovereign_authority_affected: bool(input.sovereign_authority_affected),
    critical_authenticity_unresolved: bool(input.critical_authenticity_unresolved),
    active_compromise_suspected: bool(input.active_compromise_suspected)
  };
}

function financialScore(amount) {
  if (amount >= 100000) return 28;
  if (amount >= 10000) return 18;
  if (amount >= 1000) return 8;
  return 0;
}

function exceptionalReasons(e) {
  const reasons = [];
  if (e.cross_company_boundary_attempt) reasons.push('cross-company-boundary-attempt');
  if (e.catastrophic_consequence_possible) reasons.push('catastrophic-consequence-possible');
  if (e.active_compromise_suspected && (e.privileged_change || e.sovereign_authority_affected)) reasons.push('privileged-or-sovereign-compromise-suspected');
  if (e.sovereign_authority_affected && e.critical_authenticity_unresolved) reasons.push('sovereign-authority-authenticity-unresolved');
  if (e.safety_consequence && e.critical_authenticity_unresolved) reasons.push('safety-critical-authenticity-unresolved');
  return reasons;
}

function levelFor(score, hardHigh) {
  if (hardHigh || score >= 60) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

function constraintsFor(level) {
  if (level === 'exceptional') return Object.freeze({ minimum_independent_paths: 2, adversarial_review_required: true, specialist_review_required: true, sovereign_isolation_eligible: true, model_required: false });
  if (level === 'high') return Object.freeze({ minimum_independent_paths: 2, adversarial_review_required: true, specialist_review_required: true, sovereign_isolation_eligible: false, model_required: false });
  if (level === 'medium') return Object.freeze({ minimum_independent_paths: 2, adversarial_review_required: true, specialist_review_required: false, sovereign_isolation_eligible: false, model_required: false });
  return Object.freeze({ minimum_independent_paths: 1, adversarial_review_required: false, specialist_review_required: false, sovereign_isolation_eligible: false, model_required: false });
}

export function classifyRisk(input = {}) {
  if (input.company_id == null || String(input.company_id).trim() === '') throw new Error('risk-company-id-required');
  const evidence = normaliseEvidence(input.evidence || input);
  const exceptional = exceptionalReasons(evidence);
  const factors = [];
  let score = 0;
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    if (evidence[name]) { score += weight; factors.push({ factor: name, weight }); }
  }
  const fscore = financialScore(evidence.financial_amount);
  if (fscore) { score += fscore; factors.push({ factor: 'financial_amount', weight: fscore, value: evidence.financial_amount }); }
  score = Math.min(100, score);
  const hardHigh = evidence.irreversible_change || evidence.destructive_change || evidence.safety_consequence || evidence.privileged_change || evidence.legal_or_regulatory_effect || evidence.financial_amount >= 100000;
  const level = exceptional.length ? 'exceptional' : levelFor(score, hardHigh);
  return Object.freeze({
    company_id: String(input.company_id),
    item_id: input.item_id == null ? null : String(input.item_id),
    revision_id: input.revision_id == null ? null : String(input.revision_id),
    level,
    score,
    deterministic: true,
    model_used: false,
    evidence,
    factors,
    exceptional_reasons: exceptional,
    topology_constraints: constraintsFor(level),
    classified_at: Number(input.classified_at || Date.now())
  });
}

export function riskRequiresElevatedAuthorisation(assessment) {
  return assessment?.level === 'high' || assessment?.level === 'exceptional';
}
