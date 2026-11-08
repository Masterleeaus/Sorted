// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/sales/runtime/sales-qualification-readiness.mjs
import { adaptLeadResponseObservation } from './sales-lead-response-adapter.js';

export const SALES_QUALIFICATION_READINESS_SCHEMA = 'titan-zero-starter-sales-qualification-readiness/v1';

const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const lower = (value) => clean(value)?.toLowerCase() ?? null;
const uniq = (values) => Object.freeze([...new Set(values.filter(Boolean))]);

function rejectLegacyBoundary(input) {
  if (!input || typeof input !== 'object') return;
  for (const key of ['tenant_id', 'tenant_company_id']) {
    if (key in input) throw new TypeError('legacy tenant boundaries are not accepted by Sales qualification readiness');
  }
}

function canonicalServiceKey(value) {
  return lower(value)?.replace(/\s+/g, ' ') ?? null;
}

function deriveServiceFit(observed, policy = {}) {
  const serviceNeed = canonicalServiceKey(observed.service_need);
  const supported = Array.isArray(policy.supported_services)
    ? policy.supported_services.map(canonicalServiceKey).filter(Boolean)
    : [];
  const unsupported = Array.isArray(policy.unsupported_services)
    ? policy.unsupported_services.map(canonicalServiceKey).filter(Boolean)
    : [];

  if (!serviceNeed) return { value: 'unknown', evidence: ['service_need_missing'] };
  if (unsupported.includes(serviceNeed)) return { value: 'unsupported', evidence: ['explicitly_unsupported_service'] };
  if (!supported.length) return { value: 'needs_review', evidence: ['supported_service_catalog_not_supplied'] };
  if (supported.includes(serviceNeed)) return { value: 'supported', evidence: ['service_matches_supported_catalog'] };
  return { value: 'needs_review', evidence: ['service_not_matched_to_supported_catalog'] };
}

function extractPostcode(location) {
  const match = clean(location)?.match(/\b(\d{4})\b/);
  return match?.[1] ?? null;
}

function deriveLocationFit(observed, policy = {}) {
  const location = clean(observed.location);
  if (!location) return { value: 'unknown', evidence: ['location_missing'] };

  const postcode = extractPostcode(location);
  const included = Array.isArray(policy.territory_postcodes) ? policy.territory_postcodes.map(String) : [];
  const excluded = Array.isArray(policy.excluded_postcodes) ? policy.excluded_postcodes.map(String) : [];

  if (postcode && excluded.includes(postcode)) return { value: 'out_of_territory', evidence: ['postcode_explicitly_excluded'] };
  if (!included.length) return { value: 'needs_review', evidence: ['territory_definition_not_supplied'] };
  if (!postcode) return { value: 'needs_review', evidence: ['location_has_no_deterministic_postcode'] };
  if (included.includes(postcode)) return { value: 'in_territory', evidence: ['postcode_matches_territory'] };
  return { value: 'out_of_territory', evidence: ['postcode_not_in_territory'] };
}

function deriveUrgency(observed) {
  const urgency = observed.urgency ?? 'unknown';
  return { value: urgency, evidence: [urgency === 'unknown' ? 'urgency_not_observed' : 'urgency_observed'] };
}

function deriveTiming(observed) {
  const timing = observed.timing ?? 'unknown';
  return { value: timing, evidence: [timing === 'unknown' ? 'timing_not_observed' : 'timing_observed'] };
}

function deriveContactability(observed) {
  const contactability = observed.contactability ?? 'unknown';
  const evidence = [];
  if (contactability === 'opted_out') evidence.push('contact_opted_out');
  else if (contactability === 'invalid') evidence.push('contact_invalid');
  else if (contactability === 'contactable') evidence.push('contactable_observed');
  else if (contactability === 'limited') evidence.push('contactability_limited');
  else evidence.push('contactability_unknown');
  return { value: contactability, evidence };
}

function determineMissingInformation(fields) {
  const missing = [];
  if (fields.service_fit === 'unknown') missing.push('service_need');
  if (fields.service_fit === 'needs_review') missing.push('service_fit_confirmation');
  if (fields.location_fit === 'unknown') missing.push('location');
  if (fields.location_fit === 'needs_review') missing.push('territory_confirmation');
  if (fields.timing === 'unknown') missing.push('timing');
  if (fields.contactability === 'unknown') missing.push('contactability');
  return uniq(missing);
}

function determineReadiness(fields, missing) {
  const blockers = [];
  if (fields.service_fit === 'unsupported') blockers.push('unsupported_service');
  if (fields.location_fit === 'out_of_territory') blockers.push('out_of_territory');
  if (fields.contactability === 'opted_out') blockers.push('contact_opted_out');
  if (fields.contactability === 'invalid') blockers.push('invalid_contact');
  if (missing.length) blockers.push('missing_information');

  const handoffReady = blockers.length === 0 &&
    fields.service_fit === 'supported' &&
    fields.location_fit === 'in_territory' &&
    ['contactable', 'limited'].includes(fields.contactability) &&
    fields.timing !== 'unknown';

  let state = 'qualifying';
  if (fields.service_fit === 'unsupported') state = 'disqualified';
  else if (fields.location_fit === 'out_of_territory') state = 'escalated';
  else if (fields.contactability === 'opted_out') state = 'nurture';
  else if (fields.contactability === 'invalid') state = 'escalated';
  else if (handoffReady) state = 'handoff_ready';
  else if (!missing.length) state = 'qualified';

  return { handoff_ready: handoffReady, qualification_state: state, blockers: uniq(blockers) };
}

export function evaluateSalesQualificationReadiness(input = {}) {
  rejectLegacyBoundary(input);
  rejectLegacyBoundary(input.policy);
  const adapted = input.adapted_observation ?? adaptLeadResponseObservation(input);
  const companyId = clean(input.company_id ?? adapted.company_id);
  if (!companyId) throw new TypeError('company_id is required');
  if (clean(adapted.company_id) !== companyId) throw new TypeError('cross-company adapted observation rejected');

  const policy = input.policy && typeof input.policy === 'object' ? input.policy : {};
  const service = deriveServiceFit(adapted.observed, policy);
  const location = deriveLocationFit(adapted.observed, policy);
  const urgency = deriveUrgency(adapted.observed);
  const timing = deriveTiming(adapted.observed);
  const contactability = deriveContactability(adapted.observed);

  const fields = Object.freeze({
    service_fit: service.value,
    location_fit: location.value,
    urgency: urgency.value,
    timing: timing.value,
    contactability: contactability.value
  });
  const missing = determineMissingInformation(fields);
  const readiness = determineReadiness(fields, missing);

  return Object.freeze({
    schema: SALES_QUALIFICATION_READINESS_SCHEMA,
    company_id: companyId,
    lead_ref: adapted.lead_ref,
    qualification: Object.freeze({ ...fields, missing_information: missing }),
    readiness: Object.freeze(readiness),
    evidence: Object.freeze({
      service_fit: uniq(service.evidence),
      location_fit: uniq(location.evidence),
      urgency: uniq(urgency.evidence),
      timing: uniq(timing.evidence),
      contactability: uniq(contactability.evidence)
    }),
    policy_snapshot: Object.freeze({
      supported_services_count: Array.isArray(policy.supported_services) ? policy.supported_services.length : 0,
      territory_postcodes_count: Array.isArray(policy.territory_postcodes) ? policy.territory_postcodes.length : 0,
      has_explicit_unsupported_services: Array.isArray(policy.unsupported_services) && policy.unsupported_services.length > 0,
      has_explicit_excluded_postcodes: Array.isArray(policy.excluded_postcodes) && policy.excluded_postcodes.length > 0
    }),
    deterministic: true,
    model_required: false,
    persistence_performed: false,
    authority_neutral: true,
    execution_authority: false
  });
}
