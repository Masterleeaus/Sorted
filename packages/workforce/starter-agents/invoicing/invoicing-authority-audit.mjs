const SCHEMA = 'titan.workforce.starter.invoicing.authority-audit.v1';

const CANONICAL = Object.freeze({
  invoice_owner: 'Titan CRM revenue document authority',
  payment_owner: 'Titan CRM receivable/payment lifecycle pending dedicated Titan Pay master',
  jobs_owner: 'Titan Field',
  quote_owner: 'Titan CRM',
  invoice_create_capability: 'crm.invoice.create',
  payment_reconcile_capability: 'finance.payment.reconcile',
  job_complete_capability: 'crm.work_order.complete'
});

const REQUIRED_EVIDENCE = Object.freeze([
  'job_completion',
  'accepted_quote_or_terms',
  'actual_time',
  'actual_materials',
  'tax_basis',
  'invoice_provider',
  'payment_provider'
]);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeEvidence(input = {}) {
  return Object.fromEntries(REQUIRED_EVIDENCE.map((key) => [key, Boolean(input[key])]));
}

export function auditInvoicingAuthority({ company_id, evidence = {}, connectors = {} } = {}) {
  if (!nonEmpty(company_id)) throw new TypeError('company_id is required');
  const normalizedEvidence = normalizeEvidence(evidence);
  const missing_evidence = REQUIRED_EVIDENCE.filter((key) => !normalizedEvidence[key]);
  const connector_state = {
    accounting: Boolean(connectors.accounting),
    payment: Boolean(connectors.payment),
    messaging: Boolean(connectors.messaging)
  };

  return {
    schema: SCHEMA,
    company_id: company_id.trim(),
    worker: 'Invoicing Agent',
    canonical: { ...CANONICAL },
    evidence: normalizedEvidence,
    connector_state,
    missing_evidence,
    readiness: missing_evidence.length === 0 ? 'evidence_complete_for_later_readiness_evaluation' : 'blocked_missing_evidence',
    findings: {
      create_invoice_workflow_exists: true,
      complete_job_can_request_invoice: true,
      payment_reconciliation_workflow_exists: true,
      payment_reconciliation_is_user_only: true,
      invoice_workflow_offline_enabled: true,
      payment_reconciliation_offline_enabled: false,
      canonical_invoice_owner_is_external_to_worker: true,
      canonical_payment_owner_is_external_to_worker: true,
      deterministic_exact_money_contract_verified: false,
      actual_materials_contract_verified: false,
      accounting_connector_contract_verified: connector_state.accounting,
      payment_connector_contract_verified: connector_state.payment
    },
    risk_flags: [
      ...(normalizedEvidence.tax_basis ? [] : ['tax_basis_unverified']),
      ...(normalizedEvidence.actual_time ? [] : ['actual_time_unverified']),
      ...(normalizedEvidence.actual_materials ? [] : ['actual_materials_unverified']),
      ...(connector_state.accounting ? [] : ['accounting_connector_unverified']),
      ...(connector_state.payment ? [] : ['payment_connector_unverified'])
    ],
    authority: {
      company_boundary: 'company_id',
      identity_grants_authority: false,
      authority_granted: false,
      execution_permitted: false,
      grants_authority: false,
      protected_effects_require_existing_titan_authority: ['send', 'approve', 'payment']
    }
  };
}

export { CANONICAL as INVOICING_CANONICAL_OWNERS, REQUIRED_EVIDENCE as INVOICING_AUDIT_EVIDENCE, SCHEMA as INVOICING_AUTHORITY_AUDIT_SCHEMA };
