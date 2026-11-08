// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-agent/starter-workforce/reception/runtime/reception-inbound-intake.mjs
const SUPPORTED_CHANNELS = Object.freeze(['chat','sms','whatsapp','messenger','email','webchat']);
const MAX_TEXT = 12000;

function clean(value, max = 512) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function requireCompanyId(value) {
  const id = clean(value, 128);
  if (!id) throw new TypeError('company_id is required');
  return id;
}
function stablePart(value) {
  return clean(value, 256).replace(/[^A-Za-z0-9._:-]+/g, '_');
}
function normalizeChannel(value) {
  const channel = clean(value, 32).toLowerCase();
  if (!SUPPORTED_CHANNELS.includes(channel)) throw new TypeError('unsupported reception channel');
  return channel;
}
function normalizeContact(contact = {}) {
  return Object.freeze({
    name: clean(contact.name, 240) || null,
    phone: clean(contact.phone, 80) || null,
    email: clean(contact.email, 320) || null,
    external_contact_id: clean(contact.external_contact_id, 240) || null,
  });
}
function eventIdentity(input, company_id, channel) {
  const providerEvent = stablePart(input.external_event_id || input.message_id);
  if (providerEvent) return `${company_id}:${channel}:${providerEvent}`;
  const source = [input.external_thread_id, input.sender?.external_contact_id, input.sender?.phone, input.sender?.email]
    .map(stablePart).filter(Boolean).join(':');
  const at = stablePart(input.received_at || input.timestamp);
  if (!source || !at) throw new TypeError('external_event_id/message_id or stable source+timestamp required');
  return `${company_id}:${channel}:${source}:${at}`;
}

export function normalizeReceptionInboundEvent(input = {}) {
  const company_id = requireCompanyId(input.company_id);
  const channel = normalizeChannel(input.channel);
  const text = clean(input.text ?? input.body, MAX_TEXT);
  if (!text) throw new TypeError('reception inbound text required');
  const event_id = eventIdentity(input, company_id, channel);
  const sender = normalizeContact(input.sender);
  return Object.freeze({
    schema: 'titan.zero.reception.inbound-event/v1',
    event_id,
    company_id,
    channel,
    direction: 'inbound',
    text,
    received_at: clean(input.received_at || input.timestamp, 80) || null,
    external_thread_id: clean(input.external_thread_id, 256) || null,
    external_message_id: clean(input.external_event_id || input.message_id, 256) || null,
    sender,
    source_adapter: clean(input.source_adapter, 120) || 'titan-connect',
    authority_granted: false,
    side_effect_status: 'none',
  });
}

export function createReceptionConversationState(event, prior = null) {
  if (!event || event.schema !== 'titan.zero.reception.inbound-event/v1') throw new TypeError('normalized reception event required');
  if (prior && prior.company_id !== event.company_id) throw new Error('reception state company boundary mismatch');
  if (prior && prior.channel !== event.channel) throw new Error('reception state channel mismatch');
  const conversation_id = prior?.conversation_id || `${event.company_id}:${event.channel}:${stablePart(event.external_thread_id || event.sender.external_contact_id || event.sender.phone || event.sender.email || event.event_id)}`;
  const seen = new Set(Array.isArray(prior?.processed_event_ids) ? prior.processed_event_ids : []);
  const duplicate = seen.has(event.event_id);
  if (!duplicate) seen.add(event.event_id);
  return Object.freeze({
    schema: 'titan.zero.reception.conversation-state/v1',
    company_id: event.company_id,
    channel: event.channel,
    conversation_id,
    processed_event_ids: Object.freeze([...seen].slice(-250)),
    last_event_id: event.event_id,
    last_received_at: event.received_at,
    duplicate,
    pending_handoff: prior?.pending_handoff || null,
    authority_granted: false,
  });
}

export function buildReceptionIntakeCommand(event, state) {
  if (!event || !state) throw new TypeError('event and state required');
  if (event.company_id !== state.company_id) throw new Error('reception intake company boundary mismatch');
  if (state.duplicate) return Object.freeze({
    schema: 'titan.zero.reception.intake-command/v1',
    company_id: event.company_id,
    event_id: event.event_id,
    action: 'ignore_duplicate',
    authority_granted: false,
  });
  return Object.freeze({
    schema: 'titan.zero.reception.intake-command/v1',
    company_id: event.company_id,
    event_id: event.event_id,
    conversation_id: state.conversation_id,
    action: 'route_to_reception',
    worker_role_definition_id: 'titan.customer.receptionist',
    input: Object.freeze({ channel: event.channel, text: event.text, sender: event.sender }),
    requested_capabilities: Object.freeze(['reception.capture_enquiry','reception.lookup_business_knowledge','reception.request_handoff']),
    authority_granted: false,
    governed_execution_required_for_side_effects: true,
  });
}

export const RECEPTION_INBOUND_CHANNELS = SUPPORTED_CHANNELS;
