import { createHash } from 'node:crypto';

const SCHEMA = 'titan.workforce.starter.invoicing.issue-send.v1';
const RECEIPT_SCHEMA = 'titan.workforce.starter.invoicing.issue-send-receipt.v1';
const VALID_SEND_CAPABILITIES = new Set(['crm.invoice.send', 'governed.communication.send']);
const VALID_INVOICE_CAPABILITIES = new Set(['crm.invoice.create', 'crm.invoice.issue']);

function nonEmpty(v) { return typeof v === 'string' && v.trim().length > 0; }
function clean(v) { return nonEmpty(v) ? v.trim() : null; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  return value;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function authorityEnvelope() {
  return {
    company_boundary: 'company_id', identity_grants_authority: false, authority_granted: false,
    grants_authority: false, execution_permitted: false, canonical_financial_mutation_permitted: false,
    direct_provider_send_permitted: false, command_bus_required: true, provider_receipt_required: true
  };
}
function requireCompany(company_id) { if (!nonEmpty(company_id)) throw new TypeError('company_id is required'); return company_id.trim(); }
function requireVerifiedTool(tool, expected, label) {
  if (!tool || tool.verified !== true) throw new Error(`${label}_tool_not_verified`);
  if (!nonEmpty(tool.capability) || !expected.has(tool.capability.trim())) throw new Error(`${label}_capability_not_allowed`);
  if (!nonEmpty(tool.provider_ref)) throw new Error(`${label}_provider_ref_required`);
  if (tool.command_bus_required !== true) throw new Error(`${label}_command_bus_required`);
  return { capability: tool.capability.trim(), provider_ref: tool.provider_ref.trim(), verified: true, command_bus_required: true };
}
function requireCertifiedInputs({ company_id, readiness, exact_money, review_gate, contract }) {
  if (!readiness || readiness.schema !== 'titan.workforce.starter.invoicing.readiness.v1' || readiness.ready !== true) throw new Error('invoice_readiness_required');
  if (readiness.company_id !== company_id) throw new Error('company_boundary_mismatch:readiness');
  if (!exact_money || exact_money.schema !== 'titan.workforce.starter.invoicing.exact-money.v1' || exact_money.exact_money_certified !== true) throw new Error('certified_exact_money_required');
  if (exact_money.company_id !== company_id) throw new Error('company_boundary_mismatch:exact_money');
  if (!review_gate || review_gate.schema !== 'titan.workforce.starter.invoicing.review-gates.v1') throw new Error('review_gate_required');
  if (review_gate.company_id !== company_id) throw new Error('company_boundary_mismatch:review_gate');
  if (!['not_required', 'approved'].includes(review_gate.review?.state)) throw new Error('invoice_review_not_cleared');
  if (!contract || contract.schema !== 'titan.workforce.starter.invoicing.contract.v1') throw new Error('invoicing_contract_required');
  if (contract.company_id !== company_id) throw new Error('company_boundary_mismatch:contract');
  if (Array.isArray(contract.blockers) && contract.blockers.length) throw new Error('invoicing_contract_blocked');
}

export function buildInvoiceIssueSendProposal({
  company_id, contract, readiness, exact_money, review_gate,
  canonical_invoice = {}, delivery = {}, tools = {}, trace = {}
} = {}) {
  const company = requireCompany(company_id);
  requireCertifiedInputs({ company_id: company, readiness, exact_money, review_gate, contract });
  const invoiceTool = requireVerifiedTool(tools.invoice, VALID_INVOICE_CAPABILITIES, 'invoice');
  const sendTool = requireVerifiedTool(tools.send, VALID_SEND_CAPABILITIES, 'send');
  const invoiceRef = clean(canonical_invoice.invoice_ref || contract.invoice_ref);
  if (!invoiceRef) throw new Error('canonical_invoice_ref_required');
  if (canonical_invoice.company_id && canonical_invoice.company_id !== company) throw new Error('company_boundary_mismatch:canonical_invoice');
  const recipientRef = clean(delivery.recipient_ref);
  const channel = clean(delivery.channel);
  if (!recipientRef) throw new Error('recipient_ref_required');
  if (!channel) throw new Error('delivery_channel_required');
  const calculationRef = clean(exact_money.calculation_engine_ref);
  if (!calculationRef) throw new Error('calculation_engine_ref_required');

  const contentIdentity = {
    company_id: company,
    invoice_ref: invoiceRef,
    currency: exact_money.currency,
    total_minor: exact_money.totals?.total_minor,
    calculation_engine_ref: calculationRef,
    review_decision_ref: clean(review_gate.review?.decision_ref),
    recipient_ref: recipientRef,
    channel,
    template_ref: clean(delivery.template_ref),
    attachment_ref: clean(delivery.attachment_ref)
  };
  const contentHash = digest(contentIdentity);
  const operationId = `invoice-send:${contentHash.slice(0, 32)}`;
  const idempotencyKey = `tz:${company}:invoice-send:${contentHash}`;
  const externalReferenceKey = `tz-invoice-send-${contentHash.slice(0, 40)}`;

  return {
    schema: SCHEMA,
    company_id: company,
    worker: 'Invoicing Agent',
    canonical_invoice: { invoice_ref: invoiceRef, system_of_record: 'Titan CRM', mutation_owned_by_worker: false },
    issue: {
      capability: invoiceTool.capability,
      provider_ref: invoiceTool.provider_ref,
      operation_id: operationId,
      idempotency_key: idempotencyKey,
      external_reference_key: externalReferenceKey,
      command_bus_required: true
    },
    send: {
      capability: sendTool.capability,
      provider_ref: sendTool.provider_ref,
      recipient_ref: recipientRef,
      channel,
      template_ref: clean(delivery.template_ref),
      attachment_ref: clean(delivery.attachment_ref),
      provider_side_effect_is_not_reservation_step: true,
      durable_idempotency_reservation_required_before_provider: true,
      normalized_provider_receipt_required: true
    },
    certified_inputs: {
      readiness_schema: readiness.schema,
      exact_money_schema: exact_money.schema,
      calculation_engine_ref: calculationRef,
      total_minor: exact_money.totals?.total_minor ?? null,
      currency: exact_money.currency,
      review_state: review_gate.review.state,
      review_decision_ref: clean(review_gate.review?.decision_ref)
    },
    identity: { content_hash: contentHash, operation_id: operationId, idempotency_key: idempotencyKey, external_reference_key: externalReferenceKey },
    trace: {
      trace_id: clean(trace.trace_id), correlation_id: clean(trace.correlation_id), causation_id: clean(trace.causation_id)
    },
    authority: authorityEnvelope(),
    dispatch: { state: 'proposal_only', command_bus_dispatch_eligible: false, reason: 'verified_authority_receipt_required' }
  };
}

export function evaluateInvoiceIssueSendDispatch(proposal, { company_id, authority_receipt = null, existing_receipts = [] } = {}) {
  const company = requireCompany(company_id);
  if (!proposal || proposal.schema !== SCHEMA) throw new TypeError('valid issue/send proposal is required');
  if (proposal.company_id !== company) return { allowed: false, reason: 'company_boundary_mismatch', execution_permitted: false };
  for (const receipt of existing_receipts || []) {
    if (!receipt) continue;
    if (receipt.company_id && receipt.company_id !== company) continue;
    const sameOperation = receipt.operation_id === proposal.identity.operation_id;
    const sameExternal = receipt.external_reference_key === proposal.identity.external_reference_key;
    if ((sameOperation || sameExternal) && ['accepted', 'sent', 'delivered'].includes(receipt.status)) {
      return { allowed: false, reason: 'duplicate_send_prevented', duplicate_receipt_ref: clean(receipt.receipt_ref), execution_permitted: false };
    }
    if (receipt.idempotency_key === proposal.identity.idempotency_key && receipt.content_hash && receipt.content_hash !== proposal.identity.content_hash) {
      return { allowed: false, reason: 'idempotency_content_conflict', execution_permitted: false };
    }
  }
  if (!authority_receipt || authority_receipt.verified !== true) return { allowed: false, reason: 'verified_authority_receipt_required', execution_permitted: false };
  if (authority_receipt.company_id !== company) return { allowed: false, reason: 'authority_company_boundary_mismatch', execution_permitted: false };
  if (!nonEmpty(authority_receipt.receipt_ref)) return { allowed: false, reason: 'authority_receipt_ref_required', execution_permitted: false };
  if (!['approved', 'executed'].includes(authority_receipt.status)) return { allowed: false, reason: 'authority_not_approved', execution_permitted: false };
  return {
    allowed: true,
    reason: 'ready_for_existing_titan_command_bus',
    command_bus_dispatch_eligible: true,
    authority_receipt_ref: authority_receipt.receipt_ref.trim(),
    operation_id: proposal.identity.operation_id,
    idempotency_key: proposal.identity.idempotency_key,
    external_reference_key: proposal.identity.external_reference_key,
    execution_permitted: false,
    note: 'Eligibility only; this worker never invokes the provider or mutates canonical invoice state directly.'
  };
}

export function recordInvoiceIssueSendReceipt(proposal, receipt = {}) {
  if (!proposal || proposal.schema !== SCHEMA) throw new TypeError('valid issue/send proposal is required');
  if (!nonEmpty(receipt.company_id) || receipt.company_id.trim() !== proposal.company_id) throw new Error('company_boundary_mismatch:receipt');
  if (receipt.operation_id !== proposal.identity.operation_id) throw new Error('receipt_operation_id_mismatch');
  if (receipt.idempotency_key !== proposal.identity.idempotency_key) throw new Error('receipt_idempotency_key_mismatch');
  if (receipt.external_reference_key !== proposal.identity.external_reference_key) throw new Error('receipt_external_reference_mismatch');
  if (!['accepted', 'sent', 'delivered', 'failed'].includes(receipt.status)) throw new Error('invalid_provider_receipt_status');
  if (!nonEmpty(receipt.receipt_ref)) throw new Error('receipt_ref_required');
  if (!nonEmpty(receipt.provider_ref)) throw new Error('provider_ref_required');
  return {
    schema: RECEIPT_SCHEMA,
    company_id: proposal.company_id,
    invoice_ref: proposal.canonical_invoice.invoice_ref,
    operation_id: proposal.identity.operation_id,
    idempotency_key: proposal.identity.idempotency_key,
    external_reference_key: proposal.identity.external_reference_key,
    content_hash: proposal.identity.content_hash,
    status: receipt.status,
    receipt_ref: receipt.receipt_ref.trim(),
    provider_ref: receipt.provider_ref.trim(),
    provider_message_ref: clean(receipt.provider_message_ref),
    occurred_at: clean(receipt.occurred_at),
    canonical_invoice_mutated_by_worker: false,
    authority: authorityEnvelope()
  };
}

export { SCHEMA as INVOICE_ISSUE_SEND_SCHEMA, RECEIPT_SCHEMA as INVOICE_ISSUE_SEND_RECEIPT_SCHEMA };
