// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/sales/runtime/sales-explainable-priority.mjs
import { SALES_SCORING_INPUTS } from './sales-agent-contract.js';
import { evaluateSalesQualificationReadiness } from './sales-qualification-readiness.js';

export const SALES_EXPLAINABLE_PRIORITY_SCHEMA = 'titan-zero-starter-sales-explainable-priority/v1';

export const SALES_PRIORITY_WEIGHTS = Object.freeze({
  service_fit: 0.25,
  location_fit: 0.20,
  urgency: 0.15,
  timing_clarity: 0.10,
  contactability: 0.15,
  engagement: 0.10,
  value_signal: 0.05
});

const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const clamp01 = (value, label) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    throw new TypeError(`${label} must be between 0 and 1`);
  }
  return numeric;
};

function rejectLegacyBoundary(input) {
  if (!input || typeof input !== 'object') return;
  for (const key of ['tenant_id', 'tenant_company_id']) {
    if (key in input) throw new TypeError('legacy tenant boundaries are not accepted by Sales priority scoring');
  }
}

function assertWeights(weights) {
  const keys = Object.keys(SALES_PRIORITY_WEIGHTS);
  for (const key of Object.keys(weights)) {
    if (!keys.includes(key)) throw new TypeError(`unsupported scoring weight: ${key}`);
  }
  const normalized = Object.fromEntries(keys.map((key) => {
    const value = Number(weights[key] ?? SALES_PRIORITY_WEIGHTS[key]);
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`weight ${key} must be non-negative`);
    return [key, value];
  }));
  if (Object.values(normalized).every((value) => value === 0)) throw new TypeError('at least one scoring weight must be positive');
  return Object.freeze(normalized);
}

function mapQualificationToSignals(qualification) {
  const serviceFit = qualification.service_fit === 'supported' ? 1
    : qualification.service_fit === 'unsupported' ? 0 : null;
  const locationFit = qualification.location_fit === 'in_territory' ? 1
    : qualification.location_fit === 'out_of_territory' ? 0 : null;
  const urgency = qualification.urgency === 'urgent' ? 1
    : qualification.urgency === 'high' ? 0.8
      : qualification.urgency === 'normal' ? 0.5
        : qualification.urgency === 'low' ? 0.2 : null;
  const timingClarity = qualification.timing === 'immediate' ? 1
    : ['window_known', 'date_known'].includes(qualification.timing) ? 0.8
      : qualification.timing === 'flexible' ? 0.6 : null;
  const contactability = qualification.contactability === 'contactable' ? 1
    : qualification.contactability === 'limited' ? 0.5
      : ['opted_out', 'invalid'].includes(qualification.contactability) ? 0 : null;

  return { service_fit: serviceFit, location_fit: locationFit, urgency, timing_clarity: timingClarity, contactability };
}

function normalizeModelClassifications(classifications) {
  if (classifications === null || classifications === undefined) return Object.freeze([]);
  if (!Array.isArray(classifications)) throw new TypeError('model_classifications must be an array');
  const allowedKinds = new Set(['intent', 'urgency_language', 'service_category', 'objection_type', 'timing_language']);
  return Object.freeze(classifications.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new TypeError(`model classification ${index} must be an object`);
    const kind = clean(entry.kind);
    const label = clean(entry.label);
    const evidence = clean(entry.evidence);
    const confidence = clamp01(entry.confidence, `model classification ${index} confidence`);
    if (!allowedKinds.has(kind)) throw new TypeError(`unsupported model semantic classification: ${kind}`);
    if (!label || !evidence || confidence === null) throw new TypeError('model semantic classifications require label, evidence, and confidence');
    if (entry.action || entry.execute || entry.decision || entry.priority_override || entry.score_override !== undefined) {
      throw new TypeError('model semantic classifications cannot carry actions, decisions, priority overrides, or score overrides');
    }
    return Object.freeze({ kind, label, evidence, confidence, semantic_only: true });
  }));
}

function normalizeCrmSignals(crmSignals = {}) {
  rejectLegacyBoundary(crmSignals);
  if (!crmSignals || typeof crmSignals !== 'object') return Object.freeze({ engagement: null, value_signal: null, evidence: Object.freeze([]) });
  const evidence = [];
  let engagement = null;
  let valueSignal = null;

  if (crmSignals.engagement_score !== undefined) {
    engagement = clamp01(crmSignals.engagement_score, 'crm_signals.engagement_score');
    if (crmSignals.engagement_observed !== true) throw new TypeError('engagement_score requires engagement_observed=true');
    evidence.push('observed_crm_engagement_score');
  }
  if (crmSignals.value_signal !== undefined) {
    valueSignal = clamp01(crmSignals.value_signal, 'crm_signals.value_signal');
    if (crmSignals.value_signal_observed !== true) throw new TypeError('value_signal requires value_signal_observed=true');
    evidence.push('observed_crm_value_signal');
  }
  for (const forbidden of ['estimated_value', 'fabricated_value', 'predicted_value', 'model_value_score']) {
    if (forbidden in crmSignals) throw new TypeError(`${forbidden} is not accepted as an observable CRM scoring signal`);
  }

  return Object.freeze({ engagement, value_signal: valueSignal, evidence: Object.freeze(evidence) });
}

function priorityBand(score, readiness) {
  if (readiness.qualification.contactability === 'opted_out') return 'blocked';
  if (readiness.qualification.service_fit === 'unsupported') return 'blocked';
  if (readiness.qualification.location_fit === 'out_of_territory') return 'review';
  if (score === null) return 'unscored';
  if (score >= 0.80) return 'high';
  if (score >= 0.60) return 'medium';
  if (score >= 0.40) return 'standard';
  return 'low';
}

export function scoreSalesLeadPriority(input = {}) {
  rejectLegacyBoundary(input);
  rejectLegacyBoundary(input.policy);
  const companyId = clean(input.company_id);
  if (!companyId) throw new TypeError('company_id is required');

  const readiness = input.readiness_projection ?? evaluateSalesQualificationReadiness(input);
  if (clean(readiness.company_id) !== companyId) throw new TypeError('cross-company readiness projection rejected');
  if (readiness.execution_authority !== false || readiness.authority_neutral !== true) {
    throw new TypeError('readiness projection must remain authority-neutral');
  }

  const weights = assertWeights(input.weights ?? {});
  const crm = normalizeCrmSignals(input.crm_signals ?? {});
  const modelClassifications = normalizeModelClassifications(input.model_classifications);
  const derived = mapQualificationToSignals(readiness.qualification);
  const scoringInputs = Object.freeze({
    ...derived,
    engagement: crm.engagement,
    value_signal: crm.value_signal
  });

  const contributions = [];
  let weightedSum = 0;
  let activeWeight = 0;
  for (const key of SALES_SCORING_INPUTS) {
    const value = scoringInputs[key];
    const weight = weights[key];
    const included = value !== null;
    const contribution = included ? value * weight : 0;
    if (included) {
      weightedSum += contribution;
      activeWeight += weight;
    }
    contributions.push(Object.freeze({ signal: key, value, weight, included, weighted_contribution: contribution }));
  }
  const score = activeWeight > 0 ? Number((weightedSum / activeWeight).toFixed(6)) : null;
  const band = priorityBand(score, readiness);
  const missingSignals = Object.freeze(contributions.filter((entry) => !entry.included).map((entry) => entry.signal));

  return Object.freeze({
    schema: SALES_EXPLAINABLE_PRIORITY_SCHEMA,
    company_id: companyId,
    lead_ref: readiness.lead_ref,
    qualification_state: readiness.readiness.qualification_state,
    scoring_inputs: scoringInputs,
    score,
    priority: band,
    explanation: Object.freeze({
      method: 'normalized_weighted_average_of_observable_signals',
      active_weight: Number(activeWeight.toFixed(6)),
      contributions: Object.freeze(contributions),
      missing_signals: missingSignals,
      crm_signal_evidence: crm.evidence,
      model_semantic_classifications: modelClassifications,
      model_classifications_affect_score_directly: false
    }),
    restrictions: Object.freeze({
      deterministic_scoring: true,
      opaque_model_score_allowed: false,
      model_semantic_classification_only: true,
      irreversible_decision_allowed: false,
      persistence_performed: false
    }),
    authority_neutral: true,
    execution_authority: false
  });
}
