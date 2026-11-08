// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/sales/runtime/sales-lead-response-adapter.mjs
import { createSalesRecommendation } from './sales-agent-contract.js';

export const SALES_LEAD_RESPONSE_ADAPTER_SCHEMA = 'titan-zero-starter-sales-lead-response-adapter/v1';

const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const bool = (value) => value === true;
const list = (value) => Array.isArray(value) ? value.map(text).filter(Boolean) : [];

function rejectLegacyBoundary(input) {
  if (input && typeof input === 'object' && ('tenant_id' in input || 'tenant_company_id' in input)) {
    throw new TypeError('legacy tenant boundaries are not accepted by the Sales lead-response adapter');
  }
}

function sameCompany(companyId, value, label) {
  if (value && value.company_id != null && text(value.company_id) !== companyId) {
    throw new TypeError(`cross-company ${label} rejected`);
  }
}

function canonicalUrgency(value) {
  const normalized = text(value)?.toLowerCase();
  if (['emergency', 'urgent'].includes(normalized)) return 'urgent';
  if (normalized === 'high') return 'high';
  if (['standard', 'normal', 'medium'].includes(normalized)) return 'normal';
  if (normalized === 'low') return 'low';
  return 'unknown';
}

function canonicalContactability(value, optedOut = false) {
  if (optedOut) return 'opted_out';
  const normalized = text(value)?.toLowerCase();
  if (['contactable', 'reachable', 'valid'].includes(normalized)) return 'contactable';
  if (['limited', 'unknown'].includes(normalized)) return normalized;
  if (['invalid', 'unreachable'].includes(normalized)) return 'invalid';
  return 'unknown';
}

function canonicalTiming(observation = {}) {
  if (bool(observation.immediate) || canonicalUrgency(observation.urgency) === 'urgent') return 'immediate';
  if (text(observation.preferred_time_window)) return 'window_known';
  if (text(observation.preferred_date)) return 'date_known';
  if (bool(observation.flexible_time)) return 'flexible';
  return 'unknown';
}

function completenessSignals({ serviceNeed, location, timing, contactability }) {
  return {
    service_need_present: Boolean(serviceNeed),
    location_present: Boolean(location),
    timing_present: timing !== 'unknown',
    contactable: contactability === 'contactable'
  };
}

export function adaptLeadResponseObservation(input = {}) {
  rejectLegacyBoundary(input);
  rejectLegacyBoundary(input.crm_lead);
  rejectLegacyBoundary(input.interaction);
  rejectLegacyBoundary(input.observation);

  const companyId = text(input.company_id);
  if (!companyId) throw new TypeError('company_id is required');
  const crmLead = input.crm_lead && typeof input.crm_lead === 'object' ? input.crm_lead : {};
  const interaction = input.interaction && typeof input.interaction === 'object' ? input.interaction : {};
  const observation = input.observation && typeof input.observation === 'object' ? input.observation : {};
  sameCompany(companyId, crmLead, 'CRM lead');
  sameCompany(companyId, interaction, 'interaction');
  sameCompany(companyId, observation, 'lead observation');

  const leadId = text(crmLead.lead_id ?? input.lead_id);
  if (!leadId) throw new TypeError('canonical CRM lead_id is required');

  const serviceNeed = text(observation.service_needed ?? observation.service_need ?? crmLead.service_needed ?? crmLead.service_interest);
  const location = text(observation.location ?? observation.address ?? observation.postcode ?? crmLead.service_location ?? crmLead.postcode);
  const urgency = canonicalUrgency(observation.urgency ?? crmLead.urgency);
  const contactability = canonicalContactability(
    observation.contactability ?? crmLead.contactability,
    bool(observation.opted_out) || bool(crmLead.opted_out)
  );
  const timing = canonicalTiming({ ...crmLead, ...observation, urgency });
  const signals = completenessSignals({ serviceNeed, location, timing, contactability });
  const missing = [];
  if (!signals.service_need_present) missing.push('service_need');
  if (!signals.location_present) missing.push('location');
  if (!signals.timing_present) missing.push('timing');
  if (!signals.contactable && contactability !== 'opted_out') missing.push('contactability');

  return Object.freeze({
    schema: SALES_LEAD_RESPONSE_ADAPTER_SCHEMA,
    company_id: companyId,
    lead_ref: Object.freeze({
      lead_id: leadId,
      opportunity_id: text(crmLead.opportunity_id ?? input.opportunity_id),
      customer_id: text(crmLead.customer_id ?? input.customer_id),
      correlation_id: text(interaction.correlation_id ?? input.correlation_id),
      journey_id: text(interaction.journey_id ?? input.journey_id),
      conversation_id: text(interaction.conversation_id ?? input.conversation_id)
    }),
    observed: Object.freeze({
      service_need: serviceNeed,
      location,
      urgency,
      timing,
      preferred_date: text(observation.preferred_date ?? crmLead.preferred_date),
      preferred_time_window: text(observation.preferred_time_window ?? crmLead.preferred_time_window),
      contactability,
      customer_message: text(observation.customer_message),
      customer_questions: Object.freeze(list(observation.customer_questions)),
      opted_out: contactability === 'opted_out'
    }),
    completeness: Object.freeze({ ...signals, missing_information: Object.freeze(missing) }),
    provenance: Object.freeze({
      crm_record_authoritative: true,
      observation_is_projection_only: true,
      provider_storage_accepted: false
    }),
    authority_neutral: true,
    execution_authority: false
  });
}

export function createLeadResponseRecommendation(input = {}) {
  const adapted = adaptLeadResponseObservation(input);
  const observed = adapted.observed;
  const missing = adapted.completeness.missing_information;

  let action = 'ask_more';
  let state = 'qualifying';
  const reasons = [];

  if (observed.opted_out) {
    action = 'no_action';
    state = 'nurture';
    reasons.push('contact opted out; outbound follow-up is blocked');
  } else if (input.service_fit === 'unsupported') {
    action = 'human_sales_review';
    state = 'escalated';
    reasons.push('observed service request is not confirmed as supported');
  } else if (input.location_fit === 'out_of_territory') {
    action = 'human_sales_review';
    state = 'escalated';
    reasons.push('observed location is outside configured territory');
  } else if (missing.length) {
    reasons.push(`qualification requires ${missing.join(', ')}`);
  } else if (input.booking_candidate === true) {
    action = 'recommend_booking_handoff';
    state = 'handoff_ready';
    reasons.push('service need, location, timing and contactability are observed');
    reasons.push('booking is a recommendation only; canonical Booking lifecycle must verify availability');
  } else {
    action = 'recommend_quote_handoff';
    state = 'qualified';
    reasons.push('qualification observations are complete');
    reasons.push('quote handoff preserves CRM authority and requires governed downstream execution');
  }

  const serviceFit = input.service_fit ?? (adapted.observed.service_need ? 'needs_review' : 'unknown');
  const locationFit = input.location_fit ?? (adapted.observed.location ? 'needs_review' : 'unknown');
  const completenessCount = Object.values(adapted.completeness).filter((v) => v === true).length;
  const confidence = Math.min(1, Math.max(0, Number(input.confidence ?? (completenessCount / 4))));

  return createSalesRecommendation({
    company_id: adapted.company_id,
    lead_id: adapted.lead_ref.lead_id,
    opportunity_id: adapted.lead_ref.opportunity_id,
    customer_id: adapted.lead_ref.customer_id,
    correlation_id: adapted.lead_ref.correlation_id,
    journey_id: adapted.lead_ref.journey_id,
    qualification_state: state,
    qualification: {
      service_fit: serviceFit,
      location_fit: locationFit,
      urgency: adapted.observed.urgency,
      timing: adapted.observed.timing,
      contactability: adapted.observed.contactability,
      missing_information: missing
    },
    scoring_inputs: {
      service_fit: serviceFit === 'supported' ? 1 : serviceFit === 'unsupported' ? 0 : null,
      location_fit: locationFit === 'in_territory' ? 1 : locationFit === 'out_of_territory' ? 0 : null,
      urgency: ['urgent', 'high'].includes(adapted.observed.urgency) ? 1 : adapted.observed.urgency === 'normal' ? 0.5 : null,
      timing_clarity: adapted.observed.timing === 'unknown' ? 0 : 1,
      contactability: adapted.observed.contactability === 'contactable' ? 1 : adapted.observed.contactability === 'opted_out' ? 0 : null,
      engagement: Number.isFinite(Number(input.engagement_score)) ? Number(input.engagement_score) : null,
      value_signal: null
    },
    action,
    confidence,
    reasons,
    handoff: action === 'recommend_booking_handoff' || action === 'recommend_quote_handoff' ? {
      target: action === 'recommend_booking_handoff' ? 'booking' : 'quote',
      correlation_id: adapted.lead_ref.correlation_id,
      journey_id: adapted.lead_ref.journey_id,
      idempotency_key: text(input.idempotency_key),
      reason: reasons[0]
    } : null,
    settings: input.settings,
    metrics: input.metrics
  });
}
