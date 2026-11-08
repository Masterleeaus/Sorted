const INTENTS = Object.freeze(['ACKNOWLEDGE', 'STATUS_UPDATE', 'ISSUE_RESPONSE']);
const JOB_COMPLETE_STATES = new Set(['COMPLETED', 'COMPLETE', 'CLOSED']);

export const CUSTOMER_CARE_GROUNDED_RESPONSE_CONTRACT = Object.freeze({
  schema: 'titan.workforce.customer-care.grounded-response-contract.v1',
  company_boundary: 'company_id',
  authority_rule: 'identity_does_not_grant_authority',
  source_records_remain_authoritative: true,
  requires_verified_grounding: true,
  allowed_intents: INTENTS,
  output_mode: 'PROPOSAL_ONLY',
  protected_actions: Object.freeze(['REFUND', 'CREDIT', 'FREE_REWORK', 'EXTERNAL_COMMUNICATION', 'EXTERNAL_COMMITMENT', 'APPROVAL']),
  prohibited_ungrounded_claims: Object.freeze(['JOB_COMPLETE', 'REFUND_PROMISE', 'CREDIT_PROMISE', 'FREE_REWORK_PROMISE']),
  send_requires_separate_authority: true
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

function normalizeIntent(value) {
  const intent = typeof value === 'string' ? value.trim().toUpperCase() : 'ACKNOWLEDGE';
  if (!INTENTS.includes(intent)) throw new TypeError('unsupported Customer Care response intent');
  return intent;
}

function verifyRecord(companyId, type, record, expectedId = null) {
  if (record == null) return null;
  if (typeof record !== 'object' || Array.isArray(record)) throw new TypeError(`${type} record must be an object`);
  if (record.source_verified !== true) throw new Error(`unverified ${type} grounding rejected`);
  const recordCompanyId = requireString(record.company_id, `${type}.company_id`);
  if (recordCompanyId !== companyId) throw new Error(`cross-company ${type} grounding rejected`);
  const idField = `${type}_id`;
  const recordId = optionalString(record[idField] ?? record.id, `${type}.${idField}`);
  if (expectedId && recordId && recordId !== expectedId) throw new Error(`${type} grounding id mismatch rejected`);
  return record;
}

function uniqueStrings(values) {
  return Object.freeze([...new Set((Array.isArray(values) ? values : []).filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim()))]);
}

export function buildGroundedCustomerCareContext(input = {}) {
  const company_id = requireString(input.company_id, 'company_id');
  const customer_id = requireString(input.customer_id, 'customer_id');
  const job_id = optionalString(input.job_id, 'job_id');
  const invoice_id = optionalString(input.invoice_id, 'invoice_id');
  const customer = verifyRecord(company_id, 'customer', input.records?.customer, customer_id);
  if (!customer) throw new Error('verified customer grounding is required');
  const job = verifyRecord(company_id, 'job', input.records?.job, job_id);
  const invoice = verifyRecord(company_id, 'invoice', input.records?.invoice, invoice_id);

  if (job && customer_id && job.customer_id && job.customer_id !== customer_id) throw new Error('job customer grounding mismatch rejected');
  if (invoice && customer_id && invoice.customer_id && invoice.customer_id !== customer_id) throw new Error('invoice customer grounding mismatch rejected');
  if (invoice && job_id && invoice.job_id && invoice.job_id !== job_id) throw new Error('invoice job grounding mismatch rejected');

  const jobStatus = typeof job?.status === 'string' ? job.status.trim().toUpperCase() : null;
  const facts = Object.freeze({
    customer_name: optionalString(customer.display_name ?? customer.name, 'customer.display_name'),
    job_status: jobStatus,
    job_completed_verified: Boolean(job && JOB_COMPLETE_STATES.has(jobStatus)),
    invoice_status: typeof invoice?.status === 'string' ? invoice.status.trim().toUpperCase() : null,
    invoice_total: typeof invoice?.total === 'number' && Number.isFinite(invoice.total) ? invoice.total : null,
    invoice_currency: optionalString(invoice?.currency, 'invoice.currency')
  });

  return Object.freeze({
    company_id,
    customer_id,
    job_id,
    invoice_id,
    case_id: optionalString(input.case_id, 'case_id'),
    intent: normalizeIntent(input.intent),
    facts,
    records: Object.freeze({ customer, job, invoice }),
    evidence_refs: uniqueStrings(input.evidence_refs),
    authority_granted: false,
    execution_permitted: false
  });
}

function moneyLabel(total, currency) {
  if (total == null) return null;
  return currency ? `${currency} ${total.toFixed(2)}` : total.toFixed(2);
}

export function generateBoundedCustomerCareResponse(context) {
  const company_id = requireString(context?.company_id, 'company_id');
  if (context.authority_granted !== false || context.execution_permitted !== false) throw new Error('authority-bearing response context rejected');
  const name = context.facts?.customer_name;
  const greeting = name ? `Hi ${name}, ` : '';
  let text;
  const claims = [];

  if (context.intent === 'STATUS_UPDATE') {
    if (context.facts?.job_completed_verified) {
      text = `${greeting}our records show the linked job is completed. I’ve recorded your message for the team to review.`;
      claims.push('JOB_COMPLETE_VERIFIED');
    } else if (context.facts?.job_status) {
      text = `${greeting}our records show the linked job status as ${context.facts.job_status}. I’ve recorded your message for the team to review.`;
      claims.push('JOB_STATUS_VERIFIED');
    } else {
      text = `${greeting}I’ve recorded your message for the team to review. I don’t have a verified job status to share yet.`;
    }
  } else if (context.intent === 'ISSUE_RESPONSE') {
    text = `${greeting}I’m sorry this experience needs attention. I’ve recorded the issue and the team can review the verified job and conversation details before deciding next steps.`;
    claims.push('ISSUE_ACKNOWLEDGED');
  } else {
    text = `${greeting}thanks for your message. I’ve recorded it for the team to review against the verified customer and job details.`;
    claims.push('MESSAGE_ACKNOWLEDGED');
  }

  const invoiceAmount = moneyLabel(context.facts?.invoice_total, context.facts?.invoice_currency);
  if (invoiceAmount && context.intent === 'STATUS_UPDATE') {
    text += ` The linked invoice total in our records is ${invoiceAmount}.`;
    claims.push('INVOICE_TOTAL_VERIFIED');
  }

  return Object.freeze({
    schema: 'titan.workforce.customer-care.grounded-response.v1',
    company_id,
    case_id: context.case_id ?? null,
    grounding: Object.freeze({
      customer: context.records.customer ? Object.freeze({ customer_id: context.customer_id, source_verified: true }) : null,
      job: context.records.job ? Object.freeze({ job_id: context.job_id ?? context.records.job.job_id ?? context.records.job.id ?? null, status: context.facts.job_status, source_verified: true }) : null,
      invoice: context.records.invoice ? Object.freeze({ invoice_id: context.invoice_id ?? context.records.invoice.invoice_id ?? context.records.invoice.id ?? null, status: context.facts.invoice_status, total: context.facts.invoice_total, currency: context.facts.invoice_currency, source_verified: true }) : null,
      evidence_refs: context.evidence_refs
    }),
    response: Object.freeze({ text, mode: 'PROPOSAL_ONLY', send_requires_authority: true }),
    claims: Object.freeze({ allowed: Object.freeze(claims), blocked: Object.freeze([]) }),
    authority_granted: false,
    execution_permitted: false
  });
}

const PROMISE_PATTERNS = Object.freeze([
  ['REFUND_PROMISE', /\b(?:we|i)\s+(?:will|can|have|approved|issued|processed|guarantee)\b[^.!?]{0,80}\brefund(?:ed)?\b/i],
  ['CREDIT_PROMISE', /\b(?:we|i)\s+(?:will|can|have|approved|issued|applied|guarantee)\b[^.!?]{0,80}\bcredit\b/i],
  ['FREE_REWORK_PROMISE', /\b(?:free|no[- ]charge|complimentary)\b[^.!?]{0,60}\b(?:rework|redo|return visit|service)\b/i],
  ['FREE_REWORK_PROMISE', /\b(?:we|i)\s+(?:will|can|guarantee)\b[^.!?]{0,80}\b(?:rework|redo|return visit)\b/i]
]);

const COMPLETION_PATTERN = /\b(?:job|work|service|clean(?:ing)?)\b[^.!?]{0,50}\b(?:is|was|has been)\s+(?:complete|completed|finished|done)\b/i;

export function guardCustomerCareDraft(context, draftText) {
  requireString(context?.company_id, 'company_id');
  if (context.authority_granted !== false || context.execution_permitted !== false) throw new Error('authority-bearing response context rejected');
  const text = requireString(draftText, 'draft_text');
  const blocked = [];
  for (const [code, pattern] of PROMISE_PATTERNS) if (pattern.test(text)) blocked.push(code);
  if (COMPLETION_PATTERN.test(text) && context.facts?.job_completed_verified !== true) blocked.push('UNGROUNDED_JOB_COMPLETE');
  return Object.freeze({
    allowed: blocked.length === 0,
    blocked: Object.freeze([...new Set(blocked)]),
    text,
    requires_human_review: blocked.length > 0,
    send_permitted: false,
    authority_granted: false,
    execution_permitted: false
  });
}

export function buildGroundedResponseProposal(input = {}) {
  const context = buildGroundedCustomerCareContext(input);
  const proposal = generateBoundedCustomerCareResponse(context);
  const guard = guardCustomerCareDraft(context, proposal.response.text);
  if (!guard.allowed) throw new Error(`generated Customer Care response violated bounded-response policy: ${guard.blocked.join(',')}`);
  return proposal;
}
