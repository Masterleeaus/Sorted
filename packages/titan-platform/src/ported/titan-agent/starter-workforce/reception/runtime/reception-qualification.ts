// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-agent/starter-workforce/reception/runtime/reception-qualification.mjs
const MAX_SUMMARY = 800;
const URGENCY = Object.freeze(['routine','soon','urgent','emergency','unknown']);

function clean(value, max = 512) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}
function requireCompanyId(value) {
  const id = clean(value, 128);
  if (!id) throw new TypeError('company_id is required');
  return id;
}
function nullable(value, max = 512) {
  return clean(value, max) || null;
}
function normalizeUrgency(value) {
  const normalized = clean(value, 32).toLowerCase() || 'unknown';
  return URGENCY.includes(normalized) ? normalized : 'unknown';
}
function normalizeIdentity(input = {}) {
  return Object.freeze({
    display_name: nullable(input.display_name || input.name, 150),
    customer_type: ['individual','business'].includes(clean(input.customer_type, 32).toLowerCase())
      ? clean(input.customer_type, 32).toLowerCase() : null,
    business_name: nullable(input.business_name, 180),
  });
}
function normalizeContact(input = {}) {
  return Object.freeze({
    phone: nullable(input.phone, 80),
    email: nullable(input.email, 320),
    preferred_channel: nullable(input.preferred_channel, 32),
  });
}
function normalizeLocation(input = {}) {
  return Object.freeze({
    address: nullable(input.address || input.street, 300),
    suburb: nullable(input.suburb, 120),
    state: nullable(input.state, 80),
    postcode: nullable(input.postcode, 20),
    service_area_note: nullable(input.service_area_note, 240),
  });
}
function completeness(snapshot) {
  const groups = {
    identity: Boolean(snapshot.identity.display_name || snapshot.identity.business_name),
    contact: Boolean(snapshot.contact.phone || snapshot.contact.email),
    service: Boolean(snapshot.service.requested_service),
    location: Boolean(snapshot.location.address || snapshot.location.suburb || snapshot.location.postcode || snapshot.location.service_area_note),
    urgency: snapshot.urgency !== 'unknown',
    timing: Boolean(snapshot.timing.requested_window || snapshot.timing.requested_date || snapshot.timing.flexibility_note),
    source: Boolean(snapshot.source.channel || snapshot.source.campaign || snapshot.source.referrer),
    summary: Boolean(snapshot.summary),
  };
  return Object.freeze({
    fields: Object.freeze(groups),
    captured_count: Object.values(groups).filter(Boolean).length,
    total_count: Object.keys(groups).length,
    ready_for_handoff: groups.contact && groups.service && groups.summary,
  });
}

export function buildReceptionQualificationSnapshot(input = {}) {
  const company_id = requireCompanyId(input.company_id);
  if (input.prior && input.prior.company_id !== company_id) throw new Error('qualification company boundary mismatch');
  const prior = input.prior || {};
  const identity = normalizeIdentity({ ...(prior.identity || {}), ...(input.identity || {}) });
  const contact = normalizeContact({ ...(prior.contact || {}), ...(input.contact || {}) });
  const location = normalizeLocation({ ...(prior.location || {}), ...(input.location || {}) });
  const service = Object.freeze({
    requested_service: nullable(input.service?.requested_service ?? prior.service?.requested_service, 240),
    service_variant: nullable(input.service?.service_variant ?? prior.service?.service_variant, 240),
    notes: nullable(input.service?.notes ?? prior.service?.notes, 500),
  });
  const timing = Object.freeze({
    requested_date: nullable(input.timing?.requested_date ?? prior.timing?.requested_date, 80),
    requested_window: nullable(input.timing?.requested_window ?? prior.timing?.requested_window, 160),
    flexibility_note: nullable(input.timing?.flexibility_note ?? prior.timing?.flexibility_note, 240),
  });
  const source = Object.freeze({
    channel: nullable(input.source?.channel ?? prior.source?.channel, 32),
    campaign: nullable(input.source?.campaign ?? prior.source?.campaign, 160),
    referrer: nullable(input.source?.referrer ?? prior.source?.referrer, 240),
    external_thread_id: nullable(input.source?.external_thread_id ?? prior.source?.external_thread_id, 256),
  });
  const snapshot = {
    schema: 'titan.zero.reception.qualification/v1',
    company_id,
    conversation_id: nullable(input.conversation_id ?? prior.conversation_id, 256),
    identity,
    contact,
    location,
    service,
    urgency: normalizeUrgency(input.urgency ?? prior.urgency),
    urgency_reason: nullable(input.urgency_reason ?? prior.urgency_reason, 300),
    timing,
    source,
    summary: nullable(input.summary ?? prior.summary, MAX_SUMMARY),
    authority_granted: false,
    creates_customer_record: false,
    creates_booking: false,
  };
  return Object.freeze({ ...snapshot, completeness: completeness(snapshot) });
}

export function buildQualificationCaptureCommand(snapshot) {
  if (!snapshot || snapshot.schema !== 'titan.zero.reception.qualification/v1') throw new TypeError('qualification snapshot required');
  requireCompanyId(snapshot.company_id);
  return Object.freeze({
    schema: 'titan.zero.reception.qualification-command/v1',
    company_id: snapshot.company_id,
    conversation_id: snapshot.conversation_id,
    capability: 'reception.capture_enquiry',
    qualification: snapshot,
    authority_granted: false,
    governed_execution_required_for_side_effects: true,
    canonical_customer_workflow: 'titan-business-services/workflows/new_customer.json',
  });
}

export const RECEPTION_URGENCY_LEVELS = URGENCY;
