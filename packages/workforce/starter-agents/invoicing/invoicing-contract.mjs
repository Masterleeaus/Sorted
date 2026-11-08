const SCHEMA = 'titan.workforce.starter.invoicing.contract.v1';

const LIFECYCLE_STATES = Object.freeze([
  'evidence_pending',
  'ready_for_draft',
  'draft',
  'review_pending',
  'approved',
  'issued',
  'viewed',
  'partially_paid',
  'paid',
  'overdue',
  'exception',
  'voided'
]);

const REVIEW_STATES = Object.freeze(['not_required', 'pending', 'approved', 'rejected']);
const SEND_STATES = Object.freeze(['not_requested', 'pending_authority', 'ready', 'sent', 'failed']);
const PAYMENT_STATES = Object.freeze(['unpaid', 'partial', 'paid', 'overpaid', 'disputed', 'reversed']);

const REQUIRED_EVIDENCE_KEYS = Object.freeze([
  'job_completion_ref',
  'accepted_terms_ref',
  'actual_time_ref',
  'actual_materials_ref',
  'tax_basis_ref'
]);

const EXCEPTION_CODES = Object.freeze([
  'missing_evidence',
  'calculation_basis_incomplete',
  'material_variance',
  'approval_required',
  'approval_rejected',
  'provider_unavailable',
  'authority_denied',
  'duplicate_external_reference',
  'stale_job_state',
  'payment_mismatch',
  'customer_dispute',
  'correction_required'
]);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeEvidence(evidence = {}) {
  const normalized = {};
  for (const key of REQUIRED_EVIDENCE_KEYS) {
    const value = evidence[key];
    normalized[key] = nonEmpty(value) ? value.trim() : null;
  }
  if (Array.isArray(evidence.attachment_refs)) {
    normalized.attachment_refs = evidence.attachment_refs.filter(nonEmpty).map((value) => value.trim());
  } else {
    normalized.attachment_refs = [];
  }
  return normalized;
}

function normalizeCalculationBasis(basis = {}) {
  return {
    currency: nonEmpty(basis.currency) ? basis.currency.trim().toUpperCase() : null,
    pricing_source_refs: Array.isArray(basis.pricing_source_refs) ? basis.pricing_source_refs.filter(nonEmpty).map((v) => v.trim()) : [],
    quote_or_contract_ref: nonEmpty(basis.quote_or_contract_ref) ? basis.quote_or_contract_ref.trim() : null,
    actuals_ref: nonEmpty(basis.actuals_ref) ? basis.actuals_ref.trim() : null,
    tax_basis_ref: nonEmpty(basis.tax_basis_ref) ? basis.tax_basis_ref.trim() : null,
    discount_basis_refs: Array.isArray(basis.discount_basis_refs) ? basis.discount_basis_refs.filter(nonEmpty).map((v) => v.trim()) : [],
    exact_money_certified: basis.exact_money_certified === true,
    calculation_engine_ref: nonEmpty(basis.calculation_engine_ref) ? basis.calculation_engine_ref.trim() : null
  };
}

function missingEvidence(evidence) {
  return REQUIRED_EVIDENCE_KEYS.filter((key) => !nonEmpty(evidence[key]));
}

function calculationBasisComplete(basis) {
  return nonEmpty(basis.currency)
    && nonEmpty(basis.quote_or_contract_ref)
    && nonEmpty(basis.actuals_ref)
    && nonEmpty(basis.tax_basis_ref)
    && basis.pricing_source_refs.length > 0;
}

export function createInvoicingContract({
  company_id,
  invoice_ref = null,
  job_ref = null,
  customer_ref = null,
  lifecycle_state = 'evidence_pending',
  evidence = {},
  calculation_basis = {},
  review = {},
  send = {},
  payment = {},
  exception = null,
  metadata = {}
} = {}) {
  if (!nonEmpty(company_id)) throw new TypeError('company_id is required');
  if (!LIFECYCLE_STATES.includes(lifecycle_state)) throw new TypeError(`invalid lifecycle_state: ${lifecycle_state}`);

  const normalizedEvidence = normalizeEvidence(evidence);
  const normalizedBasis = normalizeCalculationBasis(calculation_basis);
  const evidenceGaps = missingEvidence(normalizedEvidence);
  const basisComplete = calculationBasisComplete(normalizedBasis);

  const reviewState = REVIEW_STATES.includes(review.state) ? review.state : 'not_required';
  const sendState = SEND_STATES.includes(send.state) ? send.state : 'not_requested';
  const paymentState = PAYMENT_STATES.includes(payment.state) ? payment.state : 'unpaid';

  const exceptionCode = exception && EXCEPTION_CODES.includes(exception.code) ? exception.code : null;
  const blockers = [
    ...evidenceGaps.map((key) => `missing_evidence:${key}`),
    ...(basisComplete ? [] : ['calculation_basis_incomplete']),
    ...(reviewState === 'pending' ? ['review_pending'] : []),
    ...(reviewState === 'rejected' ? ['approval_rejected'] : []),
    ...(exceptionCode ? [`exception:${exceptionCode}`] : [])
  ];

  const readiness = evidenceGaps.length === 0 && basisComplete && reviewState !== 'rejected' && !exceptionCode
    ? 'contract_ready_for_draft_evaluation'
    : 'blocked';

  return {
    schema: SCHEMA,
    company_id: company_id.trim(),
    worker: 'Invoicing Agent',
    invoice_ref: nonEmpty(invoice_ref) ? invoice_ref.trim() : null,
    job_ref: nonEmpty(job_ref) ? job_ref.trim() : null,
    customer_ref: nonEmpty(customer_ref) ? customer_ref.trim() : null,
    lifecycle: {
      state: lifecycle_state,
      allowed_states: [...LIFECYCLE_STATES],
      worker_may_mutate_canonical_financial_state: false
    },
    evidence: normalizedEvidence,
    calculation_basis: normalizedBasis,
    review: {
      state: reviewState,
      reviewer_ref: nonEmpty(review.reviewer_ref) ? review.reviewer_ref.trim() : null,
      reason: nonEmpty(review.reason) ? review.reason.trim() : null,
      approval_is_external_authority: true
    },
    send: {
      state: sendState,
      channel: nonEmpty(send.channel) ? send.channel.trim() : null,
      external_reference: nonEmpty(send.external_reference) ? send.external_reference.trim() : null,
      provider_ref: nonEmpty(send.provider_ref) ? send.provider_ref.trim() : null,
      execution_requires_existing_titan_authority: true
    },
    payment: {
      state: paymentState,
      provider_ref: nonEmpty(payment.provider_ref) ? payment.provider_ref.trim() : null,
      external_reference: nonEmpty(payment.external_reference) ? payment.external_reference.trim() : null,
      reconciliation_requires_existing_titan_authority: true
    },
    exception: exceptionCode ? {
      code: exceptionCode,
      detail: nonEmpty(exception.detail) ? exception.detail.trim() : null,
      recoverable: exception.recoverable !== false
    } : null,
    blockers,
    readiness,
    metadata: clone(metadata) || {},
    authority: {
      company_boundary: 'company_id',
      identity_grants_authority: false,
      authority_granted: false,
      execution_permitted: false,
      grants_authority: false,
      canonical_invoice_owner: 'Titan CRM',
      canonical_payment_owner: 'Titan CRM / owning payment provider',
      protected_effects: ['create_canonical_invoice', 'approve', 'issue', 'send', 'reconcile_payment', 'void', 'credit', 'reissue']
    }
  };
}

export function evaluateInvoicingTransition(contract, target_state, { company_id, authority = false, external_reference = null } = {}) {
  if (!contract || contract.schema !== SCHEMA) throw new TypeError('valid invoicing contract is required');
  if (!nonEmpty(company_id)) throw new TypeError('company_id is required');
  if (company_id.trim() !== contract.company_id) {
    return { allowed: false, reason: 'company_boundary_mismatch', authority_required: false, execution_permitted: false };
  }
  if (!LIFECYCLE_STATES.includes(target_state)) {
    return { allowed: false, reason: 'invalid_target_state', authority_required: false, execution_permitted: false };
  }

  const protectedStates = new Set(['approved', 'issued', 'viewed', 'partially_paid', 'paid', 'overdue', 'voided']);
  if (contract.blockers.length > 0 && !['evidence_pending', 'exception', 'voided'].includes(target_state)) {
    return { allowed: false, reason: 'contract_blocked', blockers: [...contract.blockers], authority_required: protectedStates.has(target_state), execution_permitted: false };
  }
  if (protectedStates.has(target_state) && authority !== true) {
    return { allowed: false, reason: 'existing_titan_authority_required', authority_required: true, execution_permitted: false };
  }
  if (target_state === 'issued' && !nonEmpty(external_reference)) {
    return { allowed: false, reason: 'external_reference_required', authority_required: true, execution_permitted: false };
  }

  return {
    allowed: true,
    reason: 'transition_contract_satisfied',
    authority_required: protectedStates.has(target_state),
    execution_permitted: false,
    proposed_state: target_state,
    note: 'This evaluator proposes eligibility only; canonical mutation remains outside the worker.'
  };
}

export {
  SCHEMA as INVOICING_CONTRACT_SCHEMA,
  LIFECYCLE_STATES as INVOICING_LIFECYCLE_STATES,
  REVIEW_STATES as INVOICING_REVIEW_STATES,
  SEND_STATES as INVOICING_SEND_STATES,
  PAYMENT_STATES as INVOICING_PAYMENT_STATES,
  REQUIRED_EVIDENCE_KEYS as INVOICING_REQUIRED_EVIDENCE_KEYS,
  EXCEPTION_CODES as INVOICING_EXCEPTION_CODES
};
