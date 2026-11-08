import {
  assessCustomerCareEscalation,
  transitionCustomerCareCase
} from './customer-care-contract.mjs';
import {
  buildFeedSeverityEnvelope,
  workforceUrgencyForSeverity
} from '../../titan-runtime/feed/feed-severity.mjs';

const ISSUE_CLASSES = new Set(['NONE', 'QUALITY', 'DELAY', 'COMMUNICATION', 'BILLING', 'SAFETY', 'PRIVACY', 'PROPERTY_DAMAGE', 'OTHER']);
const CASE_SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const CUSTOMER_CARE_TRIAGE_CONTRACT = Object.freeze({
  schema: 'titan.workforce.customer-care.triage-contract.v1',
  company_boundary: 'company_id',
  authority_rule: 'identity_does_not_grant_authority',
  deterministic_only: true,
  source_records_remain_authoritative: true,
  severity_scale: Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  urgency_contract: 'titan.feed.severity.v1',
  mandatory_routes: Object.freeze({
    emergency: Object.freeze(['human_reviewer', 'safety', 'governance']),
    safety: Object.freeze(['human_reviewer', 'safety', 'governance']),
    privacy: Object.freeze(['human_reviewer', 'privacy', 'governance']),
    payment: Object.freeze(['human_reviewer', 'finance'])
  }),
  protected_effects: Object.freeze([
    'EMERGENCY_SERVICE_CONTACT',
    'REFUND',
    'CREDIT',
    'CHARGEBACK_RESPONSE',
    'LEGAL_ADMISSION',
    'PRIVACY_DISCLOSURE',
    'FREE_REWORK'
  ]),
  output_mode: 'TRIAGE_PROPOSAL_ONLY'
});

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} is required`);
  return value.trim();
}

function bool(value) { return value === true; }
function normalize(value) { return typeof value === 'string' ? value.trim().toUpperCase() : ''; }
function maxSeverity(a, b) {
  const rank = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  return rank[b] > rank[a] ? b : a;
}
function unique(values) { return Object.freeze([...new Set(values.filter(Boolean))]); }

function validateCompanyScopedEvidence(companyId, evidence = []) {
  if (!Array.isArray(evidence)) throw new TypeError('triage_evidence must be an array');
  return Object.freeze(evidence.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`triage_evidence[${index}] must be an object`);
    const evidenceCompany = requireString(item.company_id, `triage_evidence[${index}].company_id`);
    if (evidenceCompany !== companyId) throw new Error('cross-company triage evidence rejected');
    if (item.source_verified !== true) throw new Error('unverified triage evidence rejected');
    return Object.freeze({
      ref: requireString(item.ref ?? item.evidence_ref, `triage_evidence[${index}].ref`),
      company_id: evidenceCompany,
      source_verified: true
    });
  }));
}

export function triageCustomerCareCase(caseRecord, input = {}) {
  const company_id = requireString(caseRecord?.company_id, 'company_id');
  const customer_id = requireString(caseRecord?.customer_id, 'customer_id');
  const state = normalize(caseRecord?.state);
  if (state !== 'OPEN' && state !== 'TRIAGED') throw new Error('Customer Care triage requires OPEN or TRIAGED case state');

  const issue_class = ISSUE_CLASSES.has(normalize(input.issue_class ?? caseRecord.issue_class))
    ? normalize(input.issue_class ?? caseRecord.issue_class)
    : 'OTHER';
  let severity = CASE_SEVERITIES.has(normalize(input.severity ?? caseRecord.severity))
    ? normalize(input.severity ?? caseRecord.severity)
    : 'LOW';

  const signals = Object.freeze({
    immediate_danger: bool(input.signals?.immediate_danger),
    emergency_services_needed: bool(input.signals?.emergency_services_needed),
    injury_or_medical_event: bool(input.signals?.injury_or_medical_event),
    active_safety_hazard: bool(input.signals?.active_safety_hazard),
    privacy_exposure_active: bool(input.signals?.privacy_exposure_active),
    suspected_privacy_breach: bool(input.signals?.suspected_privacy_breach),
    unauthorized_payment: bool(input.signals?.unauthorized_payment),
    payment_dispute: bool(input.signals?.payment_dispute),
    chargeback_threat: bool(input.signals?.chargeback_threat),
    payment_failed_or_overdue: bool(input.signals?.payment_failed_or_overdue)
  });

  const evidence = validateCompanyScopedEvidence(company_id, input.triage_evidence ?? []);
  const reasons = [];
  const routes = [];
  let category = 'STANDARD';

  const emergency = signals.immediate_danger || signals.emergency_services_needed || signals.injury_or_medical_event;
  const safety = issue_class === 'SAFETY' || signals.active_safety_hazard || emergency;
  const privacy = issue_class === 'PRIVACY' || signals.suspected_privacy_breach || signals.privacy_exposure_active;
  const payment = issue_class === 'BILLING' || signals.unauthorized_payment || signals.payment_dispute || signals.chargeback_threat || signals.payment_failed_or_overdue;

  if (emergency) {
    category = 'EMERGENCY';
    severity = 'CRITICAL';
    reasons.push('emergency_signal');
    routes.push(...CUSTOMER_CARE_TRIAGE_CONTRACT.mandatory_routes.emergency);
  } else if (safety) {
    category = 'SAFETY';
    severity = maxSeverity(severity, 'HIGH');
    reasons.push('safety_signal');
    routes.push(...CUSTOMER_CARE_TRIAGE_CONTRACT.mandatory_routes.safety);
  }

  if (privacy) {
    if (category === 'STANDARD') category = 'PRIVACY';
    severity = maxSeverity(severity, signals.privacy_exposure_active ? 'CRITICAL' : 'HIGH');
    reasons.push(signals.privacy_exposure_active ? 'active_privacy_exposure' : 'privacy_signal');
    routes.push(...CUSTOMER_CARE_TRIAGE_CONTRACT.mandatory_routes.privacy);
  }

  if (payment) {
    if (category === 'STANDARD') category = 'PAYMENT';
    const severePayment = signals.unauthorized_payment || signals.payment_dispute || signals.chargeback_threat;
    severity = maxSeverity(severity, severePayment ? 'HIGH' : 'MEDIUM');
    reasons.push(severePayment ? 'payment_dispute_or_unauthorized' : 'payment_attention');
    routes.push(...CUSTOMER_CARE_TRIAGE_CONTRACT.mandatory_routes.payment);
    if (signals.unauthorized_payment || signals.chargeback_threat) routes.push('governance');
  }

  if (issue_class === 'PROPERTY_DAMAGE') {
    if (category === 'STANDARD') category = 'PROPERTY_DAMAGE';
    severity = maxSeverity(severity, 'HIGH');
    reasons.push('property_damage');
    routes.push('human_reviewer', 'governance');
  }

  if (category === 'STANDARD') {
    if (severity === 'LOW') reasons.push('routine_customer_care');
    else if (severity === 'MEDIUM') reasons.push('customer_care_attention');
    else reasons.push('elevated_customer_care');
    if (severity === 'HIGH' || severity === 'CRITICAL') routes.push('human_reviewer');
  }

  const candidate = Object.freeze({ ...caseRecord, issue_class, severity });
  const baseEscalation = assessCustomerCareEscalation(candidate);
  if (baseEscalation.mandatory) routes.push('governance');

  const feed_severity = buildFeedSeverityEnvelope(severity);
  const triagedCase = state === 'OPEN'
    ? transitionCustomerCareCase(candidate, 'TRIAGED')
    : Object.freeze({ ...candidate, state: 'TRIAGED', authority_granted: false, execution_permitted: false });

  const escalation_required = unique(routes).length > 0 || severity === 'CRITICAL';
  return Object.freeze({
    schema: 'titan.workforce.customer-care.triage.v1',
    company_id,
    case_id: caseRecord.case_id ?? null,
    customer_id,
    category,
    issue_class,
    severity,
    urgency: workforceUrgencyForSeverity(severity),
    feed_severity,
    reasons: unique(reasons),
    routes: unique(routes),
    evidence,
    escalation_required,
    immediate_human_attention: severity === 'CRITICAL' || category === 'EMERGENCY',
    protected_effects_remain_blocked: true,
    triaged_case: triagedCase,
    authority_granted: false,
    execution_permitted: false,
    grants_authority: false
  });
}
