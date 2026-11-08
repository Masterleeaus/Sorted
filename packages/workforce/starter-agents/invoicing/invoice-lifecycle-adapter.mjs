const SCHEMA = 'titan.workforce.starter.invoicing.lifecycle-projection.v1';

const CANONICAL_TO_WORKER = Object.freeze({
  draft: 'draft',
  sent: 'issued',
  issued: 'issued',
  viewed: 'viewed',
  partial: 'partially_paid',
  partially_paid: 'partially_paid',
  paid: 'paid',
  overdue: 'overdue',
  void: 'voided',
  voided: 'voided'
});

const APPROVAL_TO_REVIEW = Object.freeze({
  not_required: 'not_required',
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected'
});

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeStatus(value) {
  return nonEmpty(value) ? value.trim().toLowerCase() : null;
}

function normalizeIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function computeAging(dueDate, asOf) {
  const due = normalizeIso(dueDate);
  const ref = normalizeIso(asOf);
  if (!due || !ref) return { days_overdue: null, aging_bucket: 'unknown' };
  const dayMs = 86400000;
  const days = Math.floor((new Date(ref).getTime() - new Date(due).getTime()) / dayMs);
  if (days <= 0) return { days_overdue: days, aging_bucket: 'current' };
  if (days <= 30) return { days_overdue: days, aging_bucket: '1_30' };
  if (days <= 60) return { days_overdue: days, aging_bucket: '31_60' };
  if (days <= 90) return { days_overdue: days, aging_bucket: '61_90' };
  return { days_overdue: days, aging_bucket: '90_plus' };
}

export function projectCanonicalInvoiceLifecycle({
  company_id,
  canonical_invoice = {},
  as_of = new Date().toISOString()
} = {}) {
  if (!nonEmpty(company_id)) throw new TypeError('company_id is required');

  const invoiceCompany = canonical_invoice.company_id;
  if (nonEmpty(invoiceCompany) && invoiceCompany.trim() !== company_id.trim()) {
    return {
      schema: SCHEMA,
      company_id: company_id.trim(),
      worker: 'Invoicing Agent',
      accepted: false,
      reason: 'company_boundary_mismatch',
      authority: { grants_authority: false, execution_permitted: false }
    };
  }

  const canonicalStatus = normalizeStatus(canonical_invoice.status);
  const workerState = CANONICAL_TO_WORKER[canonicalStatus] || 'exception';
  const approvalStatus = normalizeStatus(canonical_invoice.approval_status) || 'not_required';
  const reviewState = APPROVAL_TO_REVIEW[approvalStatus] || 'pending';
  const aging = computeAging(canonical_invoice.due_date, as_of);
  const inferredOverdue = !['paid', 'void', 'voided'].includes(canonicalStatus) && aging.days_overdue > 0;

  const projectedState = inferredOverdue && ['draft', 'sent', 'issued', 'viewed', 'partial', 'partially_paid'].includes(canonicalStatus)
    ? 'overdue'
    : workerState;

  const blockers = [];
  if (!canonicalStatus) blockers.push('canonical_status_missing');
  if (!CANONICAL_TO_WORKER[canonicalStatus]) blockers.push('canonical_status_unmapped');
  if (!APPROVAL_TO_REVIEW[approvalStatus]) blockers.push('approval_status_unmapped');
  if (reviewState === 'pending') blockers.push('review_pending');
  if (reviewState === 'rejected') blockers.push('approval_rejected');

  return {
    schema: SCHEMA,
    company_id: company_id.trim(),
    worker: 'Invoicing Agent',
    accepted: true,
    canonical_invoice_ref: nonEmpty(canonical_invoice.invoice_ref) ? canonical_invoice.invoice_ref.trim() : null,
    source: {
      owner: 'Titan CRM revenue document authority',
      system_of_record: true,
      snapshot_only: true,
      canonical_status: canonicalStatus,
      canonical_approval_status: approvalStatus
    },
    projection: {
      lifecycle_state: projectedState,
      review_state: reviewState,
      issued_at: normalizeIso(canonical_invoice.issued_at || canonical_invoice.issued_date),
      due_at: normalizeIso(canonical_invoice.due_at || canonical_invoice.due_date),
      paid_at: normalizeIso(canonical_invoice.paid_at || canonical_invoice.paid_date),
      days_overdue: aging.days_overdue,
      aging_bucket: aging.aging_bucket,
      overdue_inferred_from_due_date: inferredOverdue
    },
    financial_refs: {
      currency: nonEmpty(canonical_invoice.currency) ? canonical_invoice.currency.trim().toUpperCase() : null,
      subtotal_ref: nonEmpty(canonical_invoice.subtotal_ref) ? canonical_invoice.subtotal_ref.trim() : null,
      tax_ref: nonEmpty(canonical_invoice.tax_ref) ? canonical_invoice.tax_ref.trim() : null,
      total_ref: nonEmpty(canonical_invoice.total_ref) ? canonical_invoice.total_ref.trim() : null,
      amount_paid_ref: nonEmpty(canonical_invoice.amount_paid_ref) ? canonical_invoice.amount_paid_ref.trim() : null,
      balance_due_ref: nonEmpty(canonical_invoice.balance_due_ref) ? canonical_invoice.balance_due_ref.trim() : null,
      exact_money_values_copied: false
    },
    commercial_context: {
      purchase_order_ref: nonEmpty(canonical_invoice.purchase_order_ref) ? canonical_invoice.purchase_order_ref.trim() : null,
      payment_terms: nonEmpty(canonical_invoice.payment_terms) ? canonical_invoice.payment_terms.trim() : null,
      cost_code: nonEmpty(canonical_invoice.cost_code) ? canonical_invoice.cost_code.trim() : null,
      department: nonEmpty(canonical_invoice.department) ? canonical_invoice.department.trim() : null,
      billing_contact_ref: nonEmpty(canonical_invoice.billing_contact_ref) ? canonical_invoice.billing_contact_ref.trim() : null
    },
    blockers,
    authority: {
      company_boundary: 'company_id',
      identity_grants_authority: false,
      grants_authority: false,
      authority_granted: false,
      execution_permitted: false,
      canonical_mutation_permitted: false,
      note: 'Projection only. Canonical invoice/payment mutation remains with existing Titan CRM/payment authority.'
    }
  };
}

export function lifecycleProjectionToContractPatch(projection) {
  if (!projection || projection.schema !== SCHEMA || projection.accepted !== true) {
    throw new TypeError('accepted lifecycle projection is required');
  }
  return {
    company_id: projection.company_id,
    invoice_ref: projection.canonical_invoice_ref,
    lifecycle_state: projection.projection.lifecycle_state,
    review: { state: projection.projection.review_state },
    metadata: {
      canonical_invoice_owner: projection.source.owner,
      canonical_status: projection.source.canonical_status,
      canonical_approval_status: projection.source.canonical_approval_status,
      due_at: projection.projection.due_at,
      aging_bucket: projection.projection.aging_bucket,
      projection_schema: projection.schema
    },
    authority: {
      grants_authority: false,
      execution_permitted: false
    }
  };
}

export { SCHEMA as INVOICE_LIFECYCLE_PROJECTION_SCHEMA, CANONICAL_TO_WORKER as CANONICAL_INVOICE_STATUS_MAP };
