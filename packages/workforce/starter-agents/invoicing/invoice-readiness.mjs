const SCHEMA = 'titan.workforce.starter.invoicing.readiness.v1';

function nonEmpty(v) { return typeof v === 'string' && v.trim().length > 0; }
function refs(v) { return Array.isArray(v) ? v.filter(nonEmpty).map(x => x.trim()) : []; }
function status(v) { return nonEmpty(v) ? v.trim().toLowerCase() : null; }

const COMPLETE_STATES = new Set(['completed', 'complete', 'closed']);

export function evaluateInvoiceReadiness({
  company_id,
  job = {},
  commercial_terms = {},
  actuals = {},
  evidence = {},
  tax = {},
  pricing = {},
  as_of = new Date().toISOString()
} = {}) {
  if (!nonEmpty(company_id)) throw new TypeError('company_id is required');
  const cid = company_id.trim();
  const sourceCompanies = [job.company_id, commercial_terms.company_id, actuals.company_id, evidence.company_id, tax.company_id, pricing.company_id]
    .filter(nonEmpty).map(v => v.trim());
  if (sourceCompanies.some(v => v !== cid)) {
    return { schema: SCHEMA, company_id: cid, ready: false, blockers: ['company_boundary_mismatch'], authority: authorityEnvelope() };
  }

  const blockers = [];
  const jobState = status(job.lifecycle_state || job.status);
  if (!COMPLETE_STATES.has(jobState)) blockers.push('job_not_completed');
  if (!nonEmpty(job.completion_ref)) blockers.push('job_completion_ref_missing');
  if (job.request_invoice !== true && job.billable !== true) blockers.push('invoice_not_requested_or_billable');
  if (job.stale === true) blockers.push('stale_job_state');

  const termsAccepted = commercial_terms.accepted === true || ['accepted', 'approved', 'signed'].includes(status(commercial_terms.status));
  if (!termsAccepted) blockers.push('commercial_terms_not_accepted');
  if (!nonEmpty(commercial_terms.accepted_terms_ref || commercial_terms.quote_or_contract_ref)) blockers.push('accepted_terms_ref_missing');
  if (commercial_terms.disputed === true) blockers.push('commercial_terms_disputed');

  if (!nonEmpty(actuals.actual_time_ref)) blockers.push('actual_time_ref_missing');
  if (!nonEmpty(actuals.actual_materials_ref)) blockers.push('actual_materials_ref_missing');
  if (actuals.unresolved === true) blockers.push('actuals_unresolved');

  const evidenceRefs = refs(evidence.attachment_refs || job.evidence_attachment_refs);
  if (evidence.required === true && evidenceRefs.length === 0) blockers.push('required_evidence_missing');
  if (refs(evidence.unresolved_issue_refs).length > 0 || job.unresolved_issues === true) blockers.push('unresolved_job_evidence');

  const unapprovedVariations = refs(commercial_terms.unapproved_variation_refs);
  if (unapprovedVariations.length > 0) blockers.push('unapproved_billable_variation');
  if (!nonEmpty(tax.tax_basis_ref)) blockers.push('tax_basis_ref_missing');

  const pricingRefs = refs(pricing.pricing_source_refs);
  if (pricingRefs.length === 0) blockers.push('pricing_source_ref_missing');
  if (!nonEmpty(pricing.currency)) blockers.push('currency_missing');

  const uniqueBlockers = [...new Set(blockers)];
  const ready = uniqueBlockers.length === 0;
  const acceptedTermsRef = commercial_terms.accepted_terms_ref || commercial_terms.quote_or_contract_ref || null;

  return {
    schema: SCHEMA,
    company_id: cid,
    worker: 'Invoicing Agent',
    ready,
    readiness_state: ready ? 'ready_for_draft_contract' : 'evidence_pending',
    blockers: uniqueBlockers,
    source_of_truth: {
      jobs: 'Titan Jobs / canonical work-order completion state',
      commercial_terms: 'Titan CRM quote/contract authority',
      invoice: 'Titan CRM revenue document authority',
      tax: 'existing Titan tax/accounting authority',
      projection_only: true
    },
    evidence: {
      job_completion_ref: nonEmpty(job.completion_ref) ? job.completion_ref.trim() : null,
      accepted_terms_ref: nonEmpty(acceptedTermsRef) ? acceptedTermsRef.trim() : null,
      actual_time_ref: nonEmpty(actuals.actual_time_ref) ? actuals.actual_time_ref.trim() : null,
      actual_materials_ref: nonEmpty(actuals.actual_materials_ref) ? actuals.actual_materials_ref.trim() : null,
      tax_basis_ref: nonEmpty(tax.tax_basis_ref) ? tax.tax_basis_ref.trim() : null,
      attachment_refs: evidenceRefs
    },
    calculation_basis: {
      currency: nonEmpty(pricing.currency) ? pricing.currency.trim().toUpperCase() : null,
      pricing_source_refs: pricingRefs,
      quote_or_contract_ref: nonEmpty(commercial_terms.quote_or_contract_ref || acceptedTermsRef) ? (commercial_terms.quote_or_contract_ref || acceptedTermsRef).trim() : null,
      actuals_ref: nonEmpty(actuals.actuals_ref) ? actuals.actuals_ref.trim() : null,
      tax_basis_ref: nonEmpty(tax.tax_basis_ref) ? tax.tax_basis_ref.trim() : null,
      discount_basis_refs: refs(pricing.discount_basis_refs),
      exact_money_certified: false,
      calculation_engine_ref: null
    },
    job_context: {
      job_ref: nonEmpty(job.job_ref) ? job.job_ref.trim() : null,
      lifecycle_state: jobState,
      completed_at: nonEmpty(job.completed_at) ? job.completed_at.trim() : null,
      request_invoice: job.request_invoice === true,
      billable: job.billable === true,
      unapproved_variation_refs: unapprovedVariations
    },
    evaluated_at: new Date(as_of).toISOString(),
    authority: authorityEnvelope()
  };
}

export function readinessToContractInput(readiness, { customer_ref = null } = {}) {
  if (!readiness || readiness.schema !== SCHEMA) throw new TypeError('valid invoice readiness result is required');
  if (readiness.ready !== true) throw new TypeError('invoice readiness must be ready before contract input can be produced');
  return {
    company_id: readiness.company_id,
    job_ref: readiness.job_context.job_ref,
    customer_ref: nonEmpty(customer_ref) ? customer_ref.trim() : null,
    lifecycle_state: 'ready_for_draft',
    evidence: { ...readiness.evidence },
    calculation_basis: { ...readiness.calculation_basis },
    metadata: {
      readiness_schema: readiness.schema,
      evaluated_at: readiness.evaluated_at,
      source_of_truth: readiness.source_of_truth
    }
  };
}

function authorityEnvelope() {
  return {
    company_boundary: 'company_id',
    identity_grants_authority: false,
    authority_granted: false,
    grants_authority: false,
    execution_permitted: false,
    canonical_mutation_permitted: false
  };
}

export { SCHEMA as INVOICE_READINESS_SCHEMA };
