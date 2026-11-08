import { createCustomerCareCase } from './customer-care-contract.mjs';

const ACCEPTED_EVENTS = Object.freeze(['complaint.received', 'customer.message.received']);
const LINK_TYPES = Object.freeze(['customer', 'job', 'location', 'invoice', 'conversation']);

export const CUSTOMER_CARE_COMPLAINT_INTAKE_CONTRACT = Object.freeze({
  schema: 'titan.workforce.customer-care.complaint-intake-contract.v1',
  company_boundary: 'company_id',
  authority_rule: 'identity_does_not_grant_authority',
  accepted_events: ACCEPTED_EVENTS,
  requires_verified_source_event: true,
  source_records_remain_authoritative: true,
  evidence_policy: Object.freeze({
    reference_preserving: true,
    immutable_descriptors: true,
    minimum_evidence_items: 1,
    raw_source_overwrite_forbidden: true
  }),
  linkage: Object.freeze({
    required: Object.freeze(['customer']),
    optional: Object.freeze(['job', 'location', 'invoice', 'conversation']),
    all_links_must_match_company: true
  }),
  duplicate_scope: 'company_id+source_event_id',
  output_state: 'OPEN',
  output_is_authority_neutral: true
});

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} is required`);
  return value.trim();
}

function optionalString(value, field) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string when provided`);
  return value.trim();
}

function normalizeEventType(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!ACCEPTED_EVENTS.includes(normalized)) throw new TypeError('unsupported Customer Care complaint intake event');
  return normalized;
}

function validateLinkedRecord(companyId, linkType, expectedId, record) {
  if (!record) return;
  if (typeof record !== 'object' || Array.isArray(record)) throw new TypeError(`${linkType} linked_record must be an object`);
  const linkedCompanyId = requireString(record.company_id, `${linkType}.company_id`);
  if (linkedCompanyId !== companyId) throw new Error(`cross-company ${linkType} link rejected`);
  const idField = `${linkType}_id`;
  const recordId = optionalString(record[idField] ?? record.id, `${linkType}.${idField}`);
  if (expectedId && recordId && expectedId !== recordId) throw new Error(`${linkType} link id mismatch rejected`);
}

function normalizeEvidenceItem(item, index) {
  if (typeof item === 'string') {
    const ref_id = requireString(item, `evidence[${index}]`);
    return Object.freeze({ ref_id, kind: 'reference', channel: null, message_id: null, content_hash: null, captured_at: null, immutable: true });
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`evidence[${index}] must be a string or object`);
  const ref_id = requireString(item.ref_id, `evidence[${index}].ref_id`);
  const kind = requireString(item.kind ?? 'conversation_evidence', `evidence[${index}].kind`);
  return Object.freeze({
    ref_id,
    kind,
    channel: optionalString(item.channel, `evidence[${index}].channel`),
    message_id: optionalString(item.message_id, `evidence[${index}].message_id`),
    content_hash: optionalString(item.content_hash, `evidence[${index}].content_hash`),
    captured_at: item.captured_at ?? null,
    immutable: true
  });
}

function normalizeEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) throw new TypeError('at least one evidence reference is required');
  const seen = new Set();
  const normalized = [];
  evidence.forEach((item, index) => {
    const descriptor = normalizeEvidenceItem(item, index);
    const key = `${descriptor.ref_id}|${descriptor.message_id ?? ''}|${descriptor.content_hash ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(descriptor);
  });
  if (normalized.length === 0) throw new TypeError('at least one unique evidence reference is required');
  return Object.freeze(normalized);
}

export function buildComplaintIntakeDedupeKey(input = {}) {
  const company_id = requireString(input.company_id, 'company_id');
  const source_event_id = requireString(input.source_event_id, 'source_event_id');
  return `${company_id}:customer-care:complaint-intake:${source_event_id}`;
}

export function createComplaintIntake(input = {}) {
  const company_id = requireString(input.company_id, 'company_id');
  const customer_id = requireString(input.customer_id, 'customer_id');
  const source_event_type = normalizeEventType(input.source_event_type);
  const source_event_id = requireString(input.source_event_id, 'source_event_id');
  if (input.source_event_verified !== true) throw new Error('unverified complaint source event rejected');

  const job_id = optionalString(input.job_id, 'job_id');
  const location_id = optionalString(input.location_id, 'location_id');
  const invoice_id = optionalString(input.invoice_id, 'invoice_id');
  const conversation_id = optionalString(input.conversation_id, 'conversation_id');
  const linkedRecords = input.linked_records ?? {};
  if (linkedRecords && (typeof linkedRecords !== 'object' || Array.isArray(linkedRecords))) throw new TypeError('linked_records must be an object');

  validateLinkedRecord(company_id, 'customer', customer_id, linkedRecords.customer);
  validateLinkedRecord(company_id, 'job', job_id, linkedRecords.job);
  validateLinkedRecord(company_id, 'location', location_id, linkedRecords.location);
  validateLinkedRecord(company_id, 'invoice', invoice_id, linkedRecords.invoice);
  validateLinkedRecord(company_id, 'conversation', conversation_id, linkedRecords.conversation);

  for (const key of Object.keys(linkedRecords)) {
    if (!LINK_TYPES.includes(key)) throw new TypeError(`unsupported linked_records type: ${key}`);
  }

  const evidence = normalizeEvidence(input.evidence);
  const dedupe_key = buildComplaintIntakeDedupeKey({ company_id, source_event_id });
  const intake_id = optionalString(input.intake_id, 'intake_id') ?? dedupe_key;

  return Object.freeze({
    schema: 'titan.workforce.customer-care.complaint-intake.v1',
    company_id,
    intake_id,
    customer_id,
    job_id,
    location_id,
    invoice_id,
    conversation_id,
    source_event_type,
    source_event_id,
    dedupe_key,
    state: 'OPEN',
    sentiment: input.sentiment ?? 'UNKNOWN',
    issue_class: input.issue_class ?? 'OTHER',
    severity: input.severity ?? 'LOW',
    evidence,
    evidence_refs: Object.freeze(evidence.map((item) => item.ref_id)),
    source_snapshot: Object.freeze({
      source_event_type,
      source_event_id,
      source_event_verified: true
    }),
    authority_granted: false,
    execution_permitted: false
  });
}

export function buildCustomerCareCaseFromComplaintIntake(intake) {
  if (!intake || typeof intake !== 'object') throw new TypeError('complaint intake is required');
  const company_id = requireString(intake.company_id, 'company_id');
  if (intake.authority_granted !== false || intake.execution_permitted !== false) throw new Error('authority-bearing complaint intake rejected');
  return createCustomerCareCase({
    company_id,
    case_id: intake.intake_id,
    customer_id: intake.customer_id,
    job_id: intake.job_id,
    location_id: intake.location_id,
    invoice_id: intake.invoice_id,
    conversation_id: intake.conversation_id,
    source_event_id: intake.source_event_id,
    sentiment: intake.sentiment,
    issue_class: intake.issue_class,
    severity: intake.severity,
    evidence_refs: intake.evidence_refs
  });
}

export class MemoryComplaintIntakeLedger {
  #entries = new Map();
  has(key) { return this.#entries.has(key); }
  get(key) { return this.#entries.get(key) ?? null; }
  record(intake) {
    const key = requireString(intake?.dedupe_key, 'dedupe_key');
    if (this.#entries.has(key)) return Object.freeze({ duplicate: true, intake: this.#entries.get(key) });
    this.#entries.set(key, intake);
    return Object.freeze({ duplicate: false, intake });
  }
}
