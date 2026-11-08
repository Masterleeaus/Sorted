// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/customer-care/customer-care-contract.mjs
const CASE_STATES = Object.freeze(['OPEN', 'TRIAGED', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'PENDING_APPROVAL', 'RESOLVED', 'CLOSED']);
const SENTIMENTS = Object.freeze(['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'UNKNOWN']);
const ISSUE_CLASSES = Object.freeze(['NONE', 'QUALITY', 'DELAY', 'COMMUNICATION', 'BILLING', 'SAFETY', 'PRIVACY', 'PROPERTY_DAMAGE', 'OTHER']);
const SEVERITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const CUSTOMER_CARE_CONTRACT = Object.freeze({
  schema: 'titan.workforce.customer-care.contract.v1',
  company_boundary: 'company_id',
  authority_rule: 'identity_does_not_grant_authority',
  trigger: Object.freeze({
    accepted_events: Object.freeze(['job.completed', 'invoice.issued', 'customer.message.received', 'complaint.received']),
    requires_verified_source_record: true,
    duplicate_suppression_required: true
  }),
  classification: Object.freeze({ sentiments: SENTIMENTS, issue_classes: ISSUE_CLASSES, severities: SEVERITIES }),
  case_lifecycle: Object.freeze({
    states: CASE_STATES,
    terminal: Object.freeze(['CLOSED']),
    transitions: Object.freeze({
      OPEN: Object.freeze(['TRIAGED']),
      TRIAGED: Object.freeze(['WAITING_CUSTOMER', 'WAITING_INTERNAL', 'PENDING_APPROVAL', 'RESOLVED']),
      WAITING_CUSTOMER: Object.freeze(['TRIAGED', 'RESOLVED']),
      WAITING_INTERNAL: Object.freeze(['TRIAGED', 'PENDING_APPROVAL', 'RESOLVED']),
      PENDING_APPROVAL: Object.freeze(['TRIAGED', 'RESOLVED']),
      RESOLVED: Object.freeze(['CLOSED', 'TRIAGED']),
      CLOSED: Object.freeze([])
    })
  }),
  remediation: Object.freeze({
    proposal_only_by_default: true,
    allowed_proposals: Object.freeze(['APOLOGY', 'STATUS_UPDATE', 'REWORK_REVIEW', 'CREDIT_REVIEW', 'REFUND_REVIEW', 'MANAGER_CALLBACK']),
    never_self_authorized: Object.freeze(['REFUND', 'CREDIT', 'FREE_REWORK', 'LEGAL_ADMISSION', 'SAFETY_COMMITMENT'])
  }),
  escalation: Object.freeze({
    mandatory_issue_classes: Object.freeze(['SAFETY', 'PRIVACY', 'PROPERTY_DAMAGE']),
    mandatory_severities: Object.freeze(['CRITICAL']),
    approval_required_for: Object.freeze(['REFUND_REVIEW', 'CREDIT_REVIEW', 'REWORK_REVIEW'])
  }),
  review_eligibility: Object.freeze({
    requires_resolved_or_no_issue: true,
    blocked_sentiments: Object.freeze(['NEGATIVE']),
    blocked_case_states: Object.freeze(['OPEN', 'TRIAGED', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'PENDING_APPROVAL'])
  }),
  handoffs: Object.freeze({
    jobs: Object.freeze(['REWORK_REVIEW', 'SERVICE_EXCEPTION']),
    rebooking: Object.freeze(['SATISFIED_REPEAT_OPPORTUNITY']),
    sales: Object.freeze(['EXPANSION_SIGNAL']),
    governance: Object.freeze(['APPROVAL_REQUIRED', 'SAFETY_OR_PRIVACY_ESCALATION'])
  })
});

function requireCompanyId(companyId) {
  if (typeof companyId !== 'string' || companyId.trim() === '') throw new TypeError('company_id is required');
  return companyId;
}

function enumValue(value, allowed, fallback) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return allowed.includes(normalized) ? normalized : fallback;
}

export function createCustomerCareCase(input = {}) {
  const company_id = requireCompanyId(input.company_id);
  if (!input.customer_id || typeof input.customer_id !== 'string') throw new TypeError('customer_id is required');
  const issue_class = enumValue(input.issue_class, ISSUE_CLASSES, 'OTHER');
  const sentiment = enumValue(input.sentiment, SENTIMENTS, 'UNKNOWN');
  const severity = enumValue(input.severity, SEVERITIES, issue_class === 'SAFETY' || issue_class === 'PRIVACY' ? 'HIGH' : 'LOW');
  return Object.freeze({
    schema: 'titan.workforce.customer-care.case.v1',
    company_id,
    case_id: input.case_id ?? null,
    customer_id: input.customer_id,
    job_id: input.job_id ?? null,
    location_id: input.location_id ?? null,
    invoice_id: input.invoice_id ?? null,
    conversation_id: input.conversation_id ?? null,
    source_event_id: input.source_event_id ?? null,
    state: 'OPEN',
    sentiment,
    issue_class,
    severity,
    evidence_refs: Object.freeze(Array.isArray(input.evidence_refs) ? [...new Set(input.evidence_refs.filter(Boolean))] : []),
    authority_granted: false,
    execution_permitted: false
  });
}

export function transitionCustomerCareCase(caseRecord, nextState) {
  requireCompanyId(caseRecord?.company_id);
  const current = enumValue(caseRecord?.state, CASE_STATES, null);
  const next = enumValue(nextState, CASE_STATES, null);
  if (!current || !next) throw new TypeError('valid current and next Customer Care states are required');
  if (!CUSTOMER_CARE_CONTRACT.case_lifecycle.transitions[current].includes(next)) {
    throw new Error(`invalid Customer Care transition ${current}->${next}`);
  }
  return Object.freeze({ ...caseRecord, state: next, authority_granted: false, execution_permitted: false });
}

export function assessCustomerCareEscalation(caseRecord, proposedRemediation = null) {
  requireCompanyId(caseRecord?.company_id);
  const issue = enumValue(caseRecord.issue_class, ISSUE_CLASSES, 'OTHER');
  const severity = enumValue(caseRecord.severity, SEVERITIES, 'LOW');
  const remediation = typeof proposedRemediation === 'string' ? proposedRemediation.trim().toUpperCase() : null;
  const mandatory = CUSTOMER_CARE_CONTRACT.escalation.mandatory_issue_classes.includes(issue) || CUSTOMER_CARE_CONTRACT.escalation.mandatory_severities.includes(severity);
  const approval_required = mandatory || CUSTOMER_CARE_CONTRACT.escalation.approval_required_for.includes(remediation);
  return Object.freeze({
    mandatory,
    approval_required,
    route: mandatory ? 'governance' : approval_required ? 'human_reviewer' : null,
    authority_granted: false,
    execution_permitted: false
  });
}

export function assessReviewEligibility(caseRecord) {
  requireCompanyId(caseRecord?.company_id);
  const sentiment = enumValue(caseRecord.sentiment, SENTIMENTS, 'UNKNOWN');
  const issue = enumValue(caseRecord.issue_class, ISSUE_CLASSES, 'OTHER');
  const state = enumValue(caseRecord.state, CASE_STATES, null);
  if (!state) throw new TypeError('valid Customer Care state is required');
  const blockers = [];
  if (CUSTOMER_CARE_CONTRACT.review_eligibility.blocked_sentiments.includes(sentiment)) blockers.push('negative_sentiment');
  if (CUSTOMER_CARE_CONTRACT.review_eligibility.blocked_case_states.includes(state)) blockers.push('unresolved_case');
  if (issue !== 'NONE' && !['RESOLVED', 'CLOSED'].includes(state)) blockers.push('issue_not_resolved');
  return Object.freeze({ eligible: blockers.length === 0, blockers: Object.freeze([...new Set(blockers)]) });
}

export function buildCustomerCareHandoff(caseRecord, target, reason, payload = {}) {
  requireCompanyId(caseRecord?.company_id);
  const normalizedTarget = typeof target === 'string' ? target.trim().toLowerCase() : '';
  if (!['jobs', 'rebooking', 'sales', 'governance'].includes(normalizedTarget)) throw new TypeError('unsupported Customer Care handoff target');
  if (!reason || typeof reason !== 'string') throw new TypeError('handoff reason is required');
  return Object.freeze({
    schema: 'titan.workforce.customer-care.handoff.v1',
    company_id: caseRecord.company_id,
    source_case_id: caseRecord.case_id ?? null,
    customer_id: caseRecord.customer_id,
    job_id: caseRecord.job_id ?? null,
    target: normalizedTarget,
    reason,
    payload: Object.freeze({ ...payload }),
    authority_granted: false,
    execution_permitted: false
  });
}
