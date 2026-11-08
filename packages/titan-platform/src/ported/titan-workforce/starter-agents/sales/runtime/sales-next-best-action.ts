// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/sales/runtime/sales-next-best-action.mjs
import { createSalesRecommendation } from './sales-agent-contract.js';
import { evaluateSalesQualificationReadiness } from './sales-qualification-readiness.js';
import { scoreSalesLeadPriority } from './sales-explainable-priority.js';

export const SALES_NEXT_BEST_ACTION_SCHEMA = 'titan-zero-starter-sales-next-best-action/v1';

const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

function rejectLegacyBoundary(input) {
  if (!input || typeof input !== 'object') return;
  for (const key of ['tenant_id', 'tenant_company_id']) {
    if (key in input) throw new TypeError('legacy tenant boundaries are not accepted by Sales next-best-action selection');
  }
}

function normalizeObservedIntent(intent = {}) {
  rejectLegacyBoundary(intent);
  if (!intent || typeof intent !== 'object') return Object.freeze({ booking: false, quote: false, evidence: Object.freeze([]) });
  for (const forbidden of ['model_action', 'model_decision', 'action_override', 'priority_override', 'score_override', 'execute']) {
    if (forbidden in intent) throw new TypeError(`${forbidden} is not accepted by Sales next-best-action selection`);
  }
  const source = clean(intent.source);
  const evidence = clean(intent.evidence);
  const booking = intent.booking === true;
  const quote = intent.quote === true;
  if ((booking || quote) && !['crm', 'interaction'].includes(source)) {
    throw new TypeError('observed booking/quote intent requires source crm or interaction');
  }
  if ((booking || quote) && !evidence) throw new TypeError('observed booking/quote intent requires evidence');
  return Object.freeze({ booking, quote, source, evidence: Object.freeze(evidence ? [evidence] : []) });
}

function chooseAction(readiness, priority, intent) {
  const q = readiness.qualification;
  const blockers = new Set(readiness.readiness.blockers ?? []);
  const missing = q.missing_information ?? [];

  if (q.contactability === 'opted_out') return { action: 'no_action', state: 'nurture', reasons: ['contact opted out; outbound Sales action is blocked'] };
  if (q.contactability === 'invalid') return { action: 'escalate', state: 'escalated', reasons: ['contact details are invalid and require governed recovery'] };
  if (q.service_fit === 'unsupported') return { action: 'recommend_decline', state: 'disqualified', reasons: ['service is explicitly unsupported by the supplied deterministic service policy'] };
  if (q.location_fit === 'out_of_territory') return { action: 'escalate', state: 'escalated', reasons: ['lead is outside configured territory; routing requires governed escalation'] };
  if (['needs_review'].includes(q.service_fit) || ['needs_review'].includes(q.location_fit)) {
    return { action: 'human_sales_review', state: 'escalated', reasons: ['service or territory fit requires human confirmation'] };
  }
  if (missing.length || blockers.has('missing_information')) {
    return { action: 'ask_more', state: 'qualifying', reasons: [`qualification requires ${missing.join(', ') || 'additional information'}`] };
  }
  if (!readiness.readiness.handoff_ready) {
    return { action: 'nurture', state: 'nurture', reasons: ['lead is not blocked but is not yet ready for a downstream handoff'] };
  }
  if (intent.booking) {
    return { action: 'recommend_booking_handoff', state: 'handoff_ready', reasons: ['customer booking intent is explicitly observed', 'canonical Booking lifecycle must verify availability and execute any booking'] };
  }
  if (intent.quote) {
    return { action: 'recommend_quote_handoff', state: 'handoff_ready', reasons: ['customer quote intent is explicitly observed', 'canonical Quote lifecycle retains pricing and execution authority'] };
  }
  if (priority.priority === 'low') {
    return { action: 'nurture', state: 'qualified', reasons: ['lead is qualified and handoff-ready but observable priority is low and no quote/booking intent is observed'] };
  }
  return { action: 'recommend_quote_handoff', state: 'handoff_ready', reasons: ['lead is deterministically handoff-ready', `observable priority is ${priority.priority}; quote is the safe default downstream recommendation`] };
}

export function selectSalesNextBestAction(input = {}) {
  rejectLegacyBoundary(input);
  rejectLegacyBoundary(input.policy);
  const companyId = clean(input.company_id);
  if (!companyId) throw new TypeError('company_id is required');

  const readiness = input.readiness_projection ?? evaluateSalesQualificationReadiness(input);
  if (clean(readiness.company_id) !== companyId) throw new TypeError('cross-company readiness projection rejected');
  if (readiness.authority_neutral !== true || readiness.execution_authority !== false) throw new TypeError('readiness projection must remain authority-neutral');

  const priority = input.priority_projection ?? scoreSalesLeadPriority({ ...input, readiness_projection: readiness });
  if (clean(priority.company_id) !== companyId) throw new TypeError('cross-company priority projection rejected');
  if (priority.authority_neutral !== true || priority.execution_authority !== false) throw new TypeError('priority projection must remain authority-neutral');
  if (clean(priority.lead_ref?.lead_id) !== clean(readiness.lead_ref?.lead_id)) throw new TypeError('priority/readiness lead mismatch rejected');

  const intent = normalizeObservedIntent(input.observed_intent);
  const selected = chooseAction(readiness, priority, intent);
  const confidence = priority.score === null ? 0.5 : Math.max(0, Math.min(1, priority.score));

  const recommendation = createSalesRecommendation({
    company_id: companyId,
    lead_id: readiness.lead_ref.lead_id,
    opportunity_id: readiness.lead_ref.opportunity_id,
    customer_id: readiness.lead_ref.customer_id,
    correlation_id: readiness.lead_ref.correlation_id,
    journey_id: readiness.lead_ref.journey_id,
    qualification_state: selected.state,
    qualification: readiness.qualification,
    scoring_inputs: priority.scoring_inputs,
    action: selected.action,
    confidence,
    reasons: selected.reasons,
    settings: input.settings,
    metrics: input.metrics
  });

  return Object.freeze({
    schema: SALES_NEXT_BEST_ACTION_SCHEMA,
    company_id: companyId,
    lead_ref: readiness.lead_ref,
    readiness_projection: readiness,
    priority_projection: priority,
    observed_intent: intent,
    recommendation,
    decision_trace: Object.freeze({
      deterministic: true,
      selected_action: selected.action,
      reasons: Object.freeze([...selected.reasons]),
      handoff_execution_performed: false,
      crm_mutation_performed: false,
      model_action_allowed: false,
      irreversible_decision_allowed: false
    }),
    authority_neutral: true,
    execution_authority: false
  });
}
