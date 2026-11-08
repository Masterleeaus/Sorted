// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-agent/starter-workforce/reception/runtime/reception-voice-adapter.mjs
const IN_PROGRESS = new Set(['queued','scheduled','ringing','in-progress','in_progress','active']);
const FAILED = new Set(['busy','no-answer','no_answer','failed','error','cancelled','canceled','machine','voicemail']);
const COMPLETED = new Set(['completed','complete','ended','finished']);
const MEANINGFUL_OUTCOMES = new Set(['message_taken','booked','escalated']);
const MAX_TRANSCRIPT_TURNS = 500;

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
function normalizeProvider(value) {
  const provider = clean(value, 80).toLowerCase();
  if (!provider) throw new TypeError('voice provider is required');
  return provider;
}
function normalizeRawStatus(value) {
  const raw = clean(value, 80).toLowerCase();
  if (!raw) throw new TypeError('voice call status is required');
  return raw;
}
function normalizeStatus(raw) {
  if (IN_PROGRESS.has(raw)) return 'in_progress';
  if (FAILED.has(raw)) return 'failed';
  if (COMPLETED.has(raw)) return 'completed';
  return 'unknown';
}
function normalizePhone(value) {
  const phone = clean(value, 80);
  return phone || null;
}
function normalizeTranscript(raw) {
  if (!raw) return Object.freeze([]);
  if (Array.isArray(raw)) {
    return Object.freeze(raw.slice(0, MAX_TRANSCRIPT_TURNS).map(turn => Object.freeze({
      role: ['assistant','agent'].includes(clean(turn?.role, 40).toLowerCase()) ? 'agent' : 'user',
      text: clean(turn?.text ?? turn?.content, 4000),
    })).filter(turn => turn.text));
  }
  if (typeof raw !== 'string') return Object.freeze([]);
  const turns = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx < 0) continue;
    const role = trimmed.slice(0, idx).trim().toLowerCase();
    const text = clean(trimmed.slice(idx + 1), 4000);
    if (!text) continue;
    turns.push(Object.freeze({ role: ['assistant','agent'].includes(role) ? 'agent' : 'user', text }));
    if (turns.length >= MAX_TRANSCRIPT_TURNS) break;
  }
  return Object.freeze(turns);
}
function eventIdentity(input, company_id, provider, call_id, raw_status) {
  const explicit = stablePart(input.external_event_id || input.webhook_event_id || input.event_id);
  if (explicit) return `${company_id}:${provider}:${explicit}`;
  const observedAt = stablePart(input.updated_at || input.received_at || input.timestamp || input.ended_at || input.started_at);
  if (!observedAt) throw new TypeError('voice webhook requires external event id or stable observed timestamp');
  return `${company_id}:${provider}:${call_id}:${stablePart(raw_status)}:${observedAt}`;
}
function trustedCompany(binding = {}) {
  return requireCompanyId(binding.company_id);
}
function verifyTrustedBinding(input = {}, company_id) {
  const spoofed = clean(input.company_id || input.tenant_id || input.organization_id, 128);
  if (spoofed && spoofed !== company_id) throw new Error('voice webhook company boundary mismatch');
}

export function normalizeReceptionVoiceWebhook(input = {}, context = {}) {
  const verification = context.verification || {};
  if (verification.verified !== true) throw new Error('verified voice webhook required');
  const verification_method = clean(verification.method || verification.scheme, 120);
  if (!verification_method) throw new TypeError('voice webhook verification method required');

  const company_id = trustedCompany(context.trusted_binding || {});
  verifyTrustedBinding(input, company_id);
  const provider = normalizeProvider(context.provider || input.provider);
  const call_id = clean(input.external_call_id || input.call_id || input.execution_id || input.id, 256);
  if (!call_id) throw new TypeError('external voice call id required');
  const raw_status = normalizeRawStatus(input.status);
  const status = normalizeStatus(raw_status);
  const event_id = eventIdentity(input, company_id, provider, call_id, raw_status);
  const duration = Number(input.duration_seconds ?? input.conversation_duration ?? input.duration);

  return Object.freeze({
    schema: 'titan.zero.reception.voice-webhook/v1',
    event_id,
    company_id,
    provider,
    external_call_id: call_id,
    raw_status,
    status,
    from_number: normalizePhone(input.from_number ?? input.telephony_data?.from_number),
    to_number: normalizePhone(input.to_number ?? input.telephony_data?.to_number),
    started_at: clean(input.started_at || input.initiated_at, 80) || null,
    ended_at: clean(input.ended_at || (status === 'completed' || status === 'failed' ? input.updated_at : ''), 80) || null,
    duration_seconds: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
    summary: clean(input.summary || input.call_summary, 4000) || null,
    transcript: normalizeTranscript(input.transcript),
    recording_reference: clean(input.recording_reference || input.recording_url, 2048) || null,
    verified: true,
    verification_method,
    authority_granted: false,
    grants_authority: false,
    effect_source: 'verified_provider_observation',
  });
}

export function createReceptionVoiceCallState(event, prior = null) {
  if (!event || event.schema !== 'titan.zero.reception.voice-webhook/v1') throw new TypeError('normalized voice webhook required');
  if (!event.verified) throw new Error('unverified voice webhook rejected');
  if (prior && prior.company_id !== event.company_id) throw new Error('voice call state company boundary mismatch');
  if (prior && prior.external_call_id !== event.external_call_id) throw new Error('voice call state call mismatch');

  const seen = new Set(Array.isArray(prior?.processed_event_ids) ? prior.processed_event_ids : []);
  const duplicate = seen.has(event.event_id);
  if (!duplicate) seen.add(event.event_id);
  const priorOutcome = clean(prior?.outcome, 80) || null;
  const outcome = MEANINGFUL_OUTCOMES.has(priorOutcome)
    ? priorOutcome
    : event.status === 'completed' ? 'info_only' : priorOutcome;

  return Object.freeze({
    schema: 'titan.zero.reception.voice-call-state/v1',
    company_id: event.company_id,
    provider: event.provider,
    external_call_id: event.external_call_id,
    status: duplicate ? (prior?.status || event.status) : (event.status === 'unknown' ? (prior?.status || 'unknown') : event.status),
    outcome,
    processed_event_ids: Object.freeze([...seen].slice(-250)),
    last_event_id: event.event_id,
    duplicate,
    verified_observation: true,
    authority_granted: false,
    grants_authority: false,
  });
}

export function buildReceptionVoicePersistenceCommand(event, state) {
  if (!event || !state) throw new TypeError('voice event and state required');
  if (event.company_id !== state.company_id) throw new Error('voice persistence company boundary mismatch');
  if (state.duplicate) return Object.freeze({
    schema: 'titan.zero.reception.voice-command/v1',
    company_id: event.company_id,
    operation_id: `reception-voice:${event.event_id}`,
    idempotency_key: event.event_id,
    action: 'ignore_duplicate',
    authority_granted: false,
  });
  if (event.status === 'unknown') return Object.freeze({
    schema: 'titan.zero.reception.voice-command/v1',
    company_id: event.company_id,
    operation_id: `reception-voice:${event.event_id}`,
    idempotency_key: event.event_id,
    action: 'acknowledge_unknown_status',
    raw_status: event.raw_status,
    authority_granted: false,
    persist_business_effect: false,
  });

  return Object.freeze({
    schema: 'titan.zero.reception.voice-command/v1',
    company_id: event.company_id,
    operation_id: `reception-voice:${event.event_id}`,
    idempotency_key: event.event_id,
    action: event.status === 'in_progress' ? 'record_call_in_progress' : event.status === 'failed' ? 'record_call_failed' : 'record_call_completed',
    external_call_id: event.external_call_id,
    provider: event.provider,
    verified_provider_observation: true,
    evidence: Object.freeze({
      status: event.status,
      raw_status: event.raw_status,
      from_number: event.from_number,
      to_number: event.to_number,
      started_at: event.started_at,
      ended_at: event.ended_at,
      duration_seconds: event.duration_seconds,
      summary: event.status === 'completed' ? event.summary : null,
      transcript: event.status === 'completed' ? event.transcript : Object.freeze([]),
      recording_reference: event.status === 'completed' ? event.recording_reference : null,
      outcome: state.outcome,
    }),
    governed_execution_required_for_persistence: true,
    authority_granted: false,
    grants_authority: false,
  });
}

export function resolveReceptionLiveCallTarget(input = {}) {
  const explicit = clean(input.external_call_id || input.call_id, 256);
  const live = Array.isArray(input.live_calls) ? input.live_calls.filter(Boolean) : [];
  if (explicit) {
    const matched = live.find(call => clean(call.external_call_id || call.call_id || call.id, 256) === explicit);
    return Object.freeze({ resolved: Boolean(matched), reason: matched ? 'explicit_call_id' : 'explicit_call_not_live', external_call_id: matched ? explicit : null, safe_to_claim_success: Boolean(matched) });
  }
  if (live.length === 1) {
    const id = clean(live[0].external_call_id || live[0].call_id || live[0].id, 256);
    return Object.freeze({ resolved: Boolean(id), reason: id ? 'single_live_call' : 'live_call_missing_id', external_call_id: id || null, safe_to_claim_success: Boolean(id) });
  }
  if (live.length > 1) return Object.freeze({ resolved: false, reason: 'ambiguous_multiple_live_calls', external_call_id: null, safe_to_claim_success: false });
  return Object.freeze({ resolved: false, reason: 'no_live_call', external_call_id: null, safe_to_claim_success: false });
}

export function interpretReceptionVoiceToolOutcome(input = {}) {
  const receipt = input.receipt || {};
  const success = receipt.authoritative === true && receipt.success === true && clean(receipt.receipt_id, 256);
  if (!success) return Object.freeze({
    success: false,
    claim_success_language: false,
    result: clean(input.fallback_result, 1000) || 'The action could not be verified. Capture the details and arrange governed follow-up.',
    authority_granted: false,
  });
  return Object.freeze({
    success: true,
    claim_success_language: true,
    result: clean(receipt.result_message, 1000) || 'The action was completed successfully.',
    receipt_id: clean(receipt.receipt_id, 256),
    authority_granted: false,
  });
}

export const RECEPTION_VOICE_STATUSES = Object.freeze({ in_progress: [...IN_PROGRESS], failed: [...FAILED], completed: [...COMPLETED] });
