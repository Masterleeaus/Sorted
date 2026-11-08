import { createHash } from 'node:crypto';

const SCHEMA = 'titan.workforce.starter.invoicing.correction.v1';
const RECEIPT_SCHEMA = 'titan.workforce.starter.invoicing.correction-receipt.v1';
const ACTIONS = Object.freeze(['cancel_draft', 'void_issued', 'credit', 'reissue']);
const DRAFT_STATES = new Set(['draft', 'ready_for_draft']);
const ISSUED_STATES = new Set(['issued', 'sent', 'viewed', 'partially_paid', 'partial', 'paid', 'overdue']);

function nonEmpty(v) { return typeof v === 'string' && v.trim().length > 0; }
function clean(v) { return nonEmpty(v) ? v.trim() : null; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function requireCompany(v) { if (!nonEmpty(v)) throw new TypeError('company_id is required'); return v.trim(); }
function integerMinor(v, name, { min = null } = {}) {
  if (typeof v === 'number') { if (!Number.isSafeInteger(v)) throw new TypeError(`${name} must be a safe integer`); v = String(v); }
  if (typeof v !== 'string' || !/^-?\d+$/.test(v.trim())) throw new TypeError(`${name} must be an integer string or safe integer`);
  const n = BigInt(v.trim());
  if (min !== null && n < BigInt(min)) throw new RangeError(`${name} must be >= ${min}`);
  return n;
}
function authorityEnvelope() {
  return {
    company_boundary: 'company_id', identity_grants_authority: false, authority_granted: false,
    grants_authority: false, execution_permitted: false, canonical_financial_mutation_permitted: false,
    destructive_invoice_mutation_permitted: false, refund_execution_permitted: false,
    protected_effect_requires_existing_titan_authority: true
  };
}
function requireInvoice(company, invoice) {
  if (!invoice || typeof invoice !== 'object') throw new TypeError('invoice is required');
  if (invoice.company_id && invoice.company_id !== company) throw new Error('company_boundary_mismatch:invoice');
  if (!nonEmpty(invoice.invoice_ref)) throw new TypeError('invoice_ref is required');
  const status = clean(invoice.status)?.toLowerCase();
  if (!status) throw new TypeError('invoice_status is required');
  return {
    invoice_ref: invoice.invoice_ref.trim(),
    status,
    currency: clean(invoice.currency)?.toUpperCase() || null,
    total_minor: invoice.total_minor == null ? null : integerMinor(invoice.total_minor, 'invoice.total_minor', { min: 0 }).toString(),
    external_reference: clean(invoice.external_reference)
  };
}
function requireTool(tool, action) {
  if (!tool || tool.verified !== true) throw new Error('correction_tool_not_verified');
  if (!nonEmpty(tool.capability)) throw new Error('correction_capability_required');
  if (!nonEmpty(tool.provider_ref)) throw new Error('correction_provider_ref_required');
  if (tool.command_bus_required !== true) throw new Error('correction_command_bus_required');
  if (tool.action && tool.action !== action) throw new Error('correction_tool_action_mismatch');
  return { capability: tool.capability.trim(), provider_ref: tool.provider_ref.trim(), command_bus_required: true, verified: true };
}
function requireReason(reason_code, reason_ref) {
  if (!nonEmpty(reason_code)) throw new TypeError('reason_code is required');
  if (!nonEmpty(reason_ref)) throw new TypeError('reason_ref is required');
  return { reason_code: reason_code.trim(), reason_ref: reason_ref.trim() };
}
function requireExactReplacement(company, exact) {
  if (!exact || exact.schema !== 'titan.workforce.starter.invoicing.exact-money.v1' || exact.exact_money_certified !== true) {
    throw new TypeError('certified replacement exact-money result is required');
  }
  if (exact.company_id !== company) throw new Error('company_boundary_mismatch:replacement_calculation');
  if (exact.reconciliation?.line_sum_matches_subtotal !== true || exact.reconciliation?.subtotal_discount_tax_matches_total !== true) {
    throw new Error('replacement_calculation_reconciliation_failed');
  }
  return exact;
}

export function buildInvoiceCorrectionProposal({
  company_id,
  action,
  invoice,
  reason_code,
  reason_ref,
  tool,
  credit = {},
  replacement_exact_money = null,
  replacement_invoice_ref = null,
  prior_corrections = []
} = {}) {
  const company = requireCompany(company_id);
  if (!ACTIONS.includes(action)) throw new TypeError('unsupported correction action');
  const source = requireInvoice(company, invoice);
  const reason = requireReason(reason_code, reason_ref);
  const binding = requireTool(tool, action);

  if (source.status === 'void' || source.status === 'voided' || source.status === 'cancelled' || source.status === 'canceled') {
    throw new Error('source_invoice_already_closed');
  }
  if (action === 'cancel_draft' && !DRAFT_STATES.has(source.status)) throw new Error('draft_cancellation_requires_draft_invoice');
  if ((action === 'void_issued' || action === 'credit' || action === 'reissue') && !ISSUED_STATES.has(source.status)) {
    throw new Error('issued_correction_requires_issued_invoice');
  }

  let creditData = null;
  let replacement = null;
  if (action === 'credit') {
    if (!source.currency || source.total_minor == null) throw new Error('source_money_snapshot_required_for_credit');
    const amount = integerMinor(credit.amount_minor, 'credit.amount_minor', { min: 1 });
    const sourceTotal = BigInt(source.total_minor);
    if (amount > sourceTotal) throw new Error('credit_exceeds_source_invoice_total');
    if (!nonEmpty(credit.credit_basis_ref)) throw new TypeError('credit_basis_ref is required');
    creditData = {
      amount_minor: amount.toString(), currency: source.currency,
      credit_basis_ref: credit.credit_basis_ref.trim(),
      refund_requested: credit.refund_requested === true,
      refund_execution_included: false
    };
  }
  if (action === 'reissue') {
    const exact = requireExactReplacement(company, replacement_exact_money);
    if (!nonEmpty(replacement_invoice_ref)) throw new TypeError('replacement_invoice_ref is required');
    if (replacement_invoice_ref.trim() === source.invoice_ref) throw new Error('replacement_invoice_must_be_new_record');
    replacement = {
      invoice_ref: replacement_invoice_ref.trim(),
      calculation_engine_ref: exact.calculation_engine_ref,
      currency: exact.currency,
      total_minor: exact.totals.total_minor,
      exact_money_certified: true,
      calculation_digest: digest({
        company_id: company, engine: exact.calculation_engine_ref, currency: exact.currency,
        totals: exact.totals, tax: exact.tax, provenance: exact.provenance
      })
    };
  }

  const identity = {
    company_id: company, action, source_invoice_ref: source.invoice_ref, source_external_reference: source.external_reference,
    reason_code: reason.reason_code, reason_ref: reason.reason_ref,
    credit: creditData ? { amount_minor: creditData.amount_minor, currency: creditData.currency, credit_basis_ref: creditData.credit_basis_ref } : null,
    replacement
  };
  const hash = digest(identity);
  const operationId = `invoice-correction:${action}:${hash.slice(0, 32)}`;
  for (const prior of prior_corrections || []) {
    if (!prior || prior.company_id !== company) continue;
    if (prior.operation_id === operationId && ['accepted', 'executed', 'succeeded', 'issued'].includes(String(prior.status || '').toLowerCase())) {
      throw new Error('duplicate_successful_correction_blocked');
    }
  }

  return {
    schema: SCHEMA,
    company_id: company,
    worker: 'Invoicing Agent',
    action,
    source_invoice: { ...source, immutable_source_record: true },
    audit: { ...reason, operation_identity_hash: hash },
    linkage: {
      source_invoice_ref: source.invoice_ref,
      predecessor_invoice_ref: action === 'reissue' ? source.invoice_ref : null,
      replacement_invoice_ref: replacement?.invoice_ref ?? null,
      credit_applies_to_invoice_ref: action === 'credit' ? source.invoice_ref : null,
      correction_chain_required: true
    },
    credit: creditData,
    replacement,
    capability: binding.capability,
    provider_ref: binding.provider_ref,
    operation_id: operationId,
    idempotency_key: `tz:${company}:invoice-correction:${hash}`,
    governance: {
      command_bus_required: true,
      proposal_only: true,
      normalized_canonical_receipt_required: true,
      original_invoice_delete_permitted: false,
      original_invoice_financial_fields_edit_permitted: false,
      existing_titan_finance_authority_required: true
    },
    authority: authorityEnvelope()
  };
}

export function validateInvoiceCorrectionReceipt(proposal, receipt = {}) {
  if (!proposal || proposal.schema !== SCHEMA) throw new TypeError('valid correction proposal is required');
  if (receipt.company_id !== proposal.company_id) throw new Error('company_boundary_mismatch:receipt');
  if (receipt.operation_id !== proposal.operation_id) throw new Error('correction_receipt_operation_mismatch');
  if (!nonEmpty(receipt.receipt_ref)) throw new TypeError('receipt_ref is required');
  if (!['accepted', 'executed', 'succeeded', 'issued'].includes(String(receipt.status || '').toLowerCase())) throw new Error('correction_receipt_not_successful');
  if (proposal.action === 'credit' && !nonEmpty(receipt.credit_note_ref)) throw new Error('credit_note_ref_required');
  if (proposal.action === 'reissue' && receipt.replacement_invoice_ref !== proposal.replacement?.invoice_ref) throw new Error('replacement_invoice_ref_mismatch');
  return {
    schema: RECEIPT_SCHEMA,
    company_id: proposal.company_id,
    action: proposal.action,
    operation_id: proposal.operation_id,
    receipt_ref: receipt.receipt_ref.trim(),
    source_invoice_ref: proposal.source_invoice.invoice_ref,
    credit_note_ref: clean(receipt.credit_note_ref),
    replacement_invoice_ref: clean(receipt.replacement_invoice_ref),
    status: String(receipt.status).toLowerCase(),
    canonical_mutation_confirmed_by_external_receipt: true,
    original_invoice_delete_confirmed: false,
    authority: authorityEnvelope()
  };
}

export function correctionProposalToContractPatch(proposal) {
  if (!proposal || proposal.schema !== SCHEMA) throw new TypeError('valid correction proposal is required');
  return {
    company_id: proposal.company_id,
    invoice_ref: proposal.source_invoice.invoice_ref,
    lifecycle_state: 'exception',
    exception: { code: 'correction_required', detail: `${proposal.action}:${proposal.audit.reason_code}`, recoverable: true },
    metadata: {
      correction_operation_id: proposal.operation_id,
      correction_action: proposal.action,
      correction_reason_ref: proposal.audit.reason_ref,
      replacement_invoice_ref: proposal.linkage.replacement_invoice_ref,
      credit_applies_to_invoice_ref: proposal.linkage.credit_applies_to_invoice_ref
    },
    authority: authorityEnvelope()
  };
}

export { SCHEMA as INVOICE_CORRECTION_SCHEMA, RECEIPT_SCHEMA as INVOICE_CORRECTION_RECEIPT_SCHEMA, ACTIONS as INVOICE_CORRECTION_ACTIONS };
