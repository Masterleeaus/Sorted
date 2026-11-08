// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/sales/runtime/sales-agent-contract.mjs
export const SALES_CONTRACT_SCHEMA = 'titan-zero-starter-sales-agent-contract/v1';

export const SALES_QUALIFICATION_STATES = Object.freeze([
  'captured', 'qualifying', 'qualified', 'nurture', 'disqualified',
  'handoff_ready', 'converted', 'escalated'
]);

export const SALES_ALLOWED_ACTIONS = Object.freeze([
  'ask_more', 'recommend_quote_handoff', 'recommend_booking_handoff', 'nurture',
  'recommend_decline', 'escalate', 'human_sales_review', 'no_action'
]);

export const SALES_QUALIFICATION_FIELDS = Object.freeze({
  service_fit: Object.freeze(['unknown', 'supported', 'unsupported', 'needs_review']),
  location_fit: Object.freeze(['unknown', 'in_territory', 'out_of_territory', 'needs_review']),
  urgency: Object.freeze(['unknown', 'low', 'normal', 'high', 'urgent']),
  timing: Object.freeze(['unknown', 'flexible', 'date_known', 'window_known', 'immediate']),
  contactability: Object.freeze(['unknown', 'contactable', 'limited', 'opted_out', 'invalid']),
  missing_information: 'string[]'
});

export const SALES_SCORING_INPUTS = Object.freeze([
  'service_fit', 'location_fit', 'urgency', 'timing_clarity',
  'contactability', 'engagement', 'value_signal'
]);

export const SALES_HANDOFF_TARGETS = Object.freeze([
  'quote', 'booking', 'reception', 'customer_care', 'human_sales'
]);

export const SALES_DEFAULT_SETTINGS = Object.freeze({
  qualification_strictness: 'balanced',
  require_service_fit_before_handoff: true,
  require_location_fit_before_handoff: true,
  max_follow_up_touches: 4,
  follow_up_cadence_hours: Object.freeze([4, 24, 72, 168]),
  quiet_hours: Object.freeze({ start: '20:00', end: '08:00' }),
  discount_authority: 'none',
  unsupported_service_action: 'human_sales_review',
  ambiguous_lead_action: 'ask_more',
  low_confidence_threshold: 0.55,
  handoff_confidence_threshold: 0.75,
  target_services: Object.freeze([]),
  territory_policy_ref: null,
  conversion_goals: Object.freeze({ quote_handoff_rate_target: null, booking_handoff_rate_target: null }),
  escalation: Object.freeze({ mode: 'human_sales_review', confidence_below: 0.55 }),
  settings_source: 'titan_settings_projection'
});

export const SALES_METRIC_KEYS = Object.freeze([
  'leads_observed', 'leads_qualified', 'leads_disqualified', 'leads_nurtured',
  'quote_handoffs_recommended', 'booking_handoffs_recommended', 'human_reviews_requested',
  'missing_information_requests', 'conversion_observations', 'recommendation_latency_ms'
]);

const cleanString = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const score = (value) => value === null || value === undefined ? null : Number(value);

export function normalizeSalesSettings(overrides = {}) {
  const merged = {
    ...SALES_DEFAULT_SETTINGS,
    ...overrides,
    quiet_hours: { ...SALES_DEFAULT_SETTINGS.quiet_hours, ...(overrides.quiet_hours || {}) },
    follow_up_cadence_hours: Array.isArray(overrides.follow_up_cadence_hours)
      ? [...overrides.follow_up_cadence_hours]
      : [...SALES_DEFAULT_SETTINGS.follow_up_cadence_hours]
  };
  if (!['strict', 'balanced', 'permissive'].includes(merged.qualification_strictness)) {
    throw new TypeError('qualification_strictness must be strict, balanced, or permissive');
  }
  if (!['none', 'external_approval_required'].includes(merged.discount_authority)) {
    throw new TypeError('Pass 2 Sales contract does not grant discount execution authority');
  }
  if (!Number.isInteger(merged.max_follow_up_touches) || merged.max_follow_up_touches < 0) {
    throw new TypeError('max_follow_up_touches must be a non-negative integer');
  }
  for (const key of ['low_confidence_threshold', 'handoff_confidence_threshold']) {
    if (!Number.isFinite(merged[key]) || merged[key] < 0 || merged[key] > 1) {
      throw new TypeError(`${key} must be between 0 and 1`);
    }
  }
  const targetServices = Array.isArray(overrides.target_services)
    ? [...new Set(overrides.target_services.map(cleanString).filter(Boolean))]
    : [...SALES_DEFAULT_SETTINGS.target_services];
  const territoryPolicyRef = cleanString(overrides.territory_policy_ref ?? SALES_DEFAULT_SETTINGS.territory_policy_ref);
  const conversionGoals = { ...SALES_DEFAULT_SETTINGS.conversion_goals, ...(overrides.conversion_goals || {}) };
  for (const key of ['quote_handoff_rate_target', 'booking_handoff_rate_target']) {
    const value = conversionGoals[key];
    if (value !== null && value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1)) {
      throw new TypeError(`conversion_goals.${key} must be null or between 0 and 1`);
    }
    conversionGoals[key] = value === null || value === undefined ? null : Number(value);
  }
  const escalation = { ...SALES_DEFAULT_SETTINGS.escalation, ...(overrides.escalation || {}) };
  if (!['human_sales_review', 'manager_review'].includes(escalation.mode)) throw new TypeError('escalation.mode must require human review');
  if (!Number.isFinite(Number(escalation.confidence_below)) || Number(escalation.confidence_below) < 0 || Number(escalation.confidence_below) > 1) {
    throw new TypeError('escalation.confidence_below must be between 0 and 1');
  }
  merged.target_services = targetServices;
  merged.territory_policy_ref = territoryPolicyRef;
  merged.conversion_goals = Object.freeze(conversionGoals);
  merged.escalation = Object.freeze({ mode: escalation.mode, confidence_below: Number(escalation.confidence_below) });
  merged.settings_source = 'titan_settings_projection';
  return Object.freeze(merged);
}

export function createSalesMetrics(seed = {}) {
  return Object.freeze(Object.fromEntries(SALES_METRIC_KEYS.map((key) => {
    const value = Number(seed[key] ?? 0);
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`metric ${key} must be non-negative`);
    return [key, value];
  })));
}

export function createSalesRecommendation(input = {}) {
  const companyId = cleanString(input.company_id);
  const leadId = cleanString(input.lead_id);
  if (!companyId) throw new TypeError('company_id is required');
  if (!leadId) throw new TypeError('lead_id is required');
  if ('tenant_id' in input || 'tenant_company_id' in input) {
    throw new TypeError('legacy tenant boundaries are not accepted by the Sales Agent contract');
  }

  const qualificationState = input.qualification_state ?? 'captured';
  if (!SALES_QUALIFICATION_STATES.includes(qualificationState)) {
    throw new TypeError(`unsupported qualification_state: ${qualificationState}`);
  }
  const action = input.action ?? 'no_action';
  if (!SALES_ALLOWED_ACTIONS.includes(action)) throw new TypeError(`unsupported Sales action: ${action}`);
  const confidence = Number(input.confidence ?? 0);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new TypeError('confidence must be between 0 and 1');
  }
  const reasons = Array.isArray(input.reasons) ? input.reasons.map(cleanString).filter(Boolean) : [];
  if (!reasons.length) throw new TypeError('at least one recommendation reason is required');

  const qualification = {
    service_fit: input.qualification?.service_fit ?? 'unknown',
    location_fit: input.qualification?.location_fit ?? 'unknown',
    urgency: input.qualification?.urgency ?? 'unknown',
    timing: input.qualification?.timing ?? 'unknown',
    contactability: input.qualification?.contactability ?? 'unknown',
    missing_information: [...new Set((input.qualification?.missing_information || []).map(cleanString).filter(Boolean))]
  };
  for (const [field, allowed] of Object.entries(SALES_QUALIFICATION_FIELDS)) {
    if (field === 'missing_information') continue;
    if (!allowed.includes(qualification[field])) throw new TypeError(`unsupported ${field}: ${qualification[field]}`);
  }

  const scoringInputs = Object.fromEntries(SALES_SCORING_INPUTS.map((key) => {
    const value = score(input.scoring_inputs?.[key]);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new TypeError(`scoring input ${key} must be null or between 0 and 1`);
    }
    return [key, value];
  }));

  let handoff = null;
  if (input.handoff) {
    const target = cleanString(input.handoff.target);
    if (!SALES_HANDOFF_TARGETS.includes(target)) throw new TypeError(`unsupported handoff target: ${target}`);
    const correlationId = cleanString(input.handoff.correlation_id ?? input.correlation_id);
    const idempotencyKey = cleanString(input.handoff.idempotency_key);
    const reason = cleanString(input.handoff.reason);
    if (!correlationId || !idempotencyKey || !reason) {
      throw new TypeError('handoff requires correlation_id, idempotency_key, and reason');
    }
    handoff = Object.freeze({
      target,
      correlation_id: correlationId,
      journey_id: cleanString(input.handoff.journey_id ?? input.journey_id),
      idempotency_key: idempotencyKey,
      reason
    });
  }

  return Object.freeze({
    schema: SALES_CONTRACT_SCHEMA,
    company_id: companyId,
    lead_ref: Object.freeze({
      lead_id: leadId,
      opportunity_id: cleanString(input.opportunity_id),
      customer_id: cleanString(input.customer_id),
      correlation_id: cleanString(input.correlation_id),
      journey_id: cleanString(input.journey_id)
    }),
    qualification_state: qualificationState,
    qualification: Object.freeze(qualification),
    scoring_inputs: Object.freeze(scoringInputs),
    allowed_actions: SALES_ALLOWED_ACTIONS,
    recommendation: Object.freeze({
      action,
      confidence,
      reasons: Object.freeze(reasons),
      authority_neutral: true,
      execution_authority: false
    }),
    handoff,
    settings: normalizeSalesSettings(input.settings),
    metrics: createSalesMetrics(input.metrics),
    authority_neutral: true,
    execution_authority: false
  });
}
