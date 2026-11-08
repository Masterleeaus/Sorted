const ACCEPTED_POST_JOB_EVENTS = Object.freeze(['job.completed', 'invoice.issued']);
const SOURCE_OWNERS = Object.freeze({
  'job.completed': 'Titan Field',
  'invoice.issued': 'Titan CRM'
});

export const POST_JOB_SATISFACTION_TRIGGER_CONTRACT = Object.freeze({
  schema: 'titan.workforce.customer-care.post-job-satisfaction-trigger.v1',
  company_boundary: 'company_id',
  authority_rule: 'identity_does_not_grant_authority',
  purpose: 'post_job_satisfaction',
  accepted_events: ACCEPTED_POST_JOB_EVENTS,
  source_owners: SOURCE_OWNERS,
  requires_verified_source_record: true,
  requires_customer_consent: true,
  quiet_hours_enforced: true,
  duplicate_scope: 'company_id+customer_id+job_id+purpose',
  output_is_proposal_only: true
});

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} is required`);
  return value.trim();
}

function normalizeEventType(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!ACCEPTED_POST_JOB_EVENTS.includes(normalized)) throw new TypeError('unsupported post-job satisfaction event');
  return normalized;
}

function normalizeHour(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 23) throw new TypeError(`${field} must be an integer 0-23`);
  return value;
}

function isQuietHour(localHour, quietHours) {
  if (!quietHours?.enabled) return false;
  const start = normalizeHour(quietHours.start_hour, 'quiet_hours.start_hour');
  const end = normalizeHour(quietHours.end_hour, 'quiet_hours.end_hour');
  if (start === end) return true;
  return start < end ? localHour >= start && localHour < end : localHour >= start || localHour < end;
}

export function buildPostJobSatisfactionDedupeKey(input = {}) {
  const company_id = requireString(input.company_id, 'company_id');
  const customer_id = requireString(input.customer_id, 'customer_id');
  const job_id = requireString(input.job_id, 'job_id');
  return `${company_id}:${customer_id}:${job_id}:post_job_satisfaction`;
}

export class MemoryCustomerCareTriggerLedger {
  #entries = new Map();

  has(key) { return this.#entries.has(key); }
  get(key) { return this.#entries.get(key) ?? null; }
  record(key, record) {
    if (this.#entries.has(key)) return this.#entries.get(key);
    const frozen = Object.freeze({ ...record });
    this.#entries.set(key, frozen);
    return frozen;
  }
  size() { return this.#entries.size; }
}

function verifySource(event) {
  const event_type = normalizeEventType(event?.type);
  const event_id = requireString(event?.event_id, 'source_event.event_id');
  const source_record = event?.source_record;
  if (!source_record || source_record.verified !== true) {
    return Object.freeze({ ok: false, reason: 'unverified_source_record', event_type, event_id });
  }
  if (source_record.owner !== SOURCE_OWNERS[event_type]) {
    return Object.freeze({ ok: false, reason: 'wrong_source_owner', event_type, event_id });
  }
  const sourceCompany = requireString(source_record.company_id, 'source_event.source_record.company_id');
  return Object.freeze({ ok: true, event_type, event_id, sourceCompany });
}

export function evaluatePostJobSatisfactionTrigger(input = {}, ports = {}) {
  const company_id = requireString(input.company_id, 'company_id');
  const customer_id = requireString(input.customer_id, 'customer_id');
  const job_id = requireString(input.job_id, 'job_id');
  const source = verifySource(input.source_event);
  const dedupe_key = buildPostJobSatisfactionDedupeKey({ company_id, customer_id, job_id });

  const base = {
    schema: 'titan.workforce.customer-care.trigger-decision.v1',
    company_id,
    customer_id,
    job_id,
    source_event_id: source.event_id,
    source_event_type: source.event_type,
    dedupe_key,
    purpose: 'post_job_satisfaction',
    authority_granted: false,
    execution_permitted: false
  };

  if (!source.ok) return Object.freeze({ ...base, eligible: false, status: 'BLOCKED', reason: source.reason });
  if (source.sourceCompany !== company_id) return Object.freeze({ ...base, eligible: false, status: 'BLOCKED', reason: 'cross_company_source_record' });

  const recordJobId = requireString(input.source_event.source_record.job_id, 'source_event.source_record.job_id');
  if (recordJobId !== job_id) return Object.freeze({ ...base, eligible: false, status: 'BLOCKED', reason: 'job_source_mismatch' });
  if (source.event_type === 'invoice.issued') {
    requireString(input.source_event.source_record.invoice_id, 'source_event.source_record.invoice_id');
  }

  const consent = input.contact_preferences;
  if (!consent || consent.status !== 'GRANTED') {
    return Object.freeze({ ...base, eligible: false, status: 'BLOCKED', reason: 'customer_contact_consent_missing' });
  }
  const channel = typeof input.channel === 'string' ? input.channel.trim().toLowerCase() : '';
  if (!channel || !Array.isArray(consent.allowed_channels) || !consent.allowed_channels.map(v => String(v).toLowerCase()).includes(channel)) {
    return Object.freeze({ ...base, eligible: false, status: 'BLOCKED', reason: 'channel_not_consented' });
  }

  const ledger = ports.ledger;
  if (!ledger || typeof ledger.has !== 'function' || typeof ledger.record !== 'function') throw new TypeError('trigger ledger port is required');
  if (ledger.has(dedupe_key)) {
    return Object.freeze({ ...base, eligible: false, status: 'SUPPRESSED_DUPLICATE', reason: 'duplicate_post_job_satisfaction', prior: ledger.get?.(dedupe_key) ?? null });
  }

  const local_hour = normalizeHour(input.customer_local_hour, 'customer_local_hour');
  if (isQuietHour(local_hour, input.quiet_hours)) {
    return Object.freeze({ ...base, eligible: false, status: 'DEFERRED_QUIET_HOURS', reason: 'quiet_hours', next_local_hour: input.quiet_hours.end_hour });
  }

  const proposal = Object.freeze({
    ...base,
    eligible: true,
    status: 'PROPOSE_OUTREACH',
    channel,
    template_intent: 'post_job_satisfaction_check',
    reason: null
  });
  ledger.record(dedupe_key, {
    company_id,
    customer_id,
    job_id,
    source_event_id: source.event_id,
    source_event_type: source.event_type,
    status: 'PROPOSE_OUTREACH'
  });
  return proposal;
}
