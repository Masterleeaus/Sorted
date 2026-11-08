const SCHEMA = 'titan.workforce.starter.invoicing.review-gates.v1';
const REVIEW_STATES = Object.freeze(['not_required', 'pending', 'approved', 'rejected']);

function nonEmpty(v) { return typeof v === 'string' && v.trim().length > 0; }
function intBig(v, name, { min = null } = {}) {
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new TypeError(`${name} must be a safe integer`);
    v = String(v);
  }
  if (typeof v !== 'string' || !/^-?\d+$/.test(v.trim())) throw new TypeError(`${name} must be an integer string or safe integer`);
  const n = BigInt(v.trim());
  if (min !== null && n < BigInt(min)) throw new RangeError(`${name} must be >= ${min}`);
  return n;
}
function bpsVariance(actual, reference) {
  if (reference === 0n) return actual === 0n ? 0n : 1000000n;
  const diff = actual >= reference ? actual - reference : reference - actual;
  return (diff * 10000n + (reference / 2n)) / reference;
}
function unique(values) { return [...new Set(values)]; }

function requireExactMoney(result, companyId) {
  if (!result || result.schema !== 'titan.workforce.starter.invoicing.exact-money.v1' || result.exact_money_certified !== true) {
    throw new TypeError('certified exact-money result is required');
  }
  if (result.company_id !== companyId) throw new Error('company_boundary_mismatch');
  return result;
}

export function evaluateInvoiceReviewGate({
  company_id,
  exact_money_result,
  readiness = null,
  quoted_total_minor = null,
  policy = {},
  signals = {}
} = {}) {
  if (!nonEmpty(company_id)) throw new TypeError('company_id is required');
  const company = company_id.trim();
  const exact = requireExactMoney(exact_money_result, company);
  const total = intBig(exact.totals?.total_minor, 'exact_money_result.totals.total_minor', { min: 0 });

  const highValueThreshold = policy.high_value_threshold_minor == null ? null : intBig(policy.high_value_threshold_minor, 'policy.high_value_threshold_minor', { min: 0 });
  const varianceThresholdBps = policy.quote_variance_review_bps == null ? null : intBig(policy.quote_variance_review_bps, 'policy.quote_variance_review_bps', { min: 0 });
  const allowedTaxModes = Array.isArray(policy.allowed_tax_modes) && policy.allowed_tax_modes.length > 0
    ? policy.allowed_tax_modes.map(v => String(v).trim().toLowerCase())
    : ['exclusive', 'zero', 'exempt'];
  const allowedTaxRates = Array.isArray(policy.allowed_tax_rate_bps)
    ? policy.allowed_tax_rate_bps.map((v, i) => intBig(v, `policy.allowed_tax_rate_bps[${i}]`, { min: 0 }).toString())
    : [];

  const reasons = [];
  const scopes = [];
  const details = {};

  if (readiness && readiness.company_id && readiness.company_id !== company) throw new Error('company_boundary_mismatch');
  if (readiness && readiness.ready !== true) {
    reasons.push('incomplete_invoice_evidence');
    scopes.push('invoice_evidence_exception');
    details.readiness_blockers = Array.isArray(readiness.blockers) ? [...readiness.blockers] : [];
  }

  if (highValueThreshold !== null && total >= highValueThreshold) {
    reasons.push('high_value_invoice');
    scopes.push('high_value_invoice');
    details.high_value_threshold_minor = highValueThreshold.toString();
  }

  if (quoted_total_minor != null) {
    const quoted = intBig(quoted_total_minor, 'quoted_total_minor', { min: 0 });
    const variance = bpsVariance(total, quoted);
    details.quote_total_minor = quoted.toString();
    details.quote_variance_bps = variance.toString();
    if (varianceThresholdBps === null) {
      reasons.push('quote_variance_policy_missing');
      scopes.push('quote_variance');
    } else if (variance > varianceThresholdBps) {
      reasons.push('quote_variance_exceeds_threshold');
      scopes.push('quote_variance');
    }
  }

  const discountRefs = [
    ...(Array.isArray(exact.line_items) ? exact.line_items.map(x => x?.discount_basis_ref).filter(nonEmpty) : []),
    ...(nonEmpty(exact.invoice_discount?.basis_ref) ? [exact.invoice_discount.basis_ref] : [])
  ];
  const discountMinor = intBig(exact.totals?.line_discounts_minor ?? '0', 'line_discounts_minor', { min: 0 })
    + intBig(exact.totals?.invoice_discount_minor ?? '0', 'invoice_discount_minor', { min: 0 });
  if (discountMinor > 0n && (signals.manual_discount === true || policy.review_any_discount === true)) {
    reasons.push('manual_or_policy_discount_review');
    scopes.push('manual_discount');
    details.discount_basis_refs = discountRefs;
    details.discount_minor = discountMinor.toString();
  }

  if (signals.credit_requested === true || signals.credit_minor != null) {
    if (signals.credit_minor != null) details.credit_minor = intBig(signals.credit_minor, 'signals.credit_minor', { min: 0 }).toString();
    reasons.push('credit_requires_review');
    scopes.push('credit_or_adjustment');
  }

  const taxMode = String(exact.tax?.mode || '').toLowerCase();
  const taxRate = String(exact.tax?.rate_bps ?? '0');
  const unusualTax = signals.tax_override === true
    || !allowedTaxModes.includes(taxMode)
    || (allowedTaxRates.length > 0 && taxMode === 'exclusive' && !allowedTaxRates.includes(taxRate));
  if (unusualTax) {
    reasons.push('unusual_or_overridden_tax');
    scopes.push('tax_exception');
    details.tax = { mode: taxMode, rate_bps: taxRate, tax_basis_ref: exact.tax?.tax_basis_ref ?? null };
  }

  if (signals.post_calculation_edit === true) {
    if (!nonEmpty(signals.edit_ref)) throw new TypeError('signals.edit_ref is required for post-calculation edits');
    reasons.push('post_calculation_edit_requires_review');
    scopes.push('post_calculation_edit');
    details.edit_ref = signals.edit_ref.trim();
  }

  if (signals.unresolved_dispute === true) {
    reasons.push('customer_or_job_dispute');
    scopes.push('dispute_resolution');
  }

  const reviewRequired = reasons.length > 0;
  return {
    schema: SCHEMA,
    company_id: company,
    worker: 'Invoicing Agent',
    review_required: reviewRequired,
    review: {
      state: reviewRequired ? 'pending' : 'not_required',
      reasons: unique(reasons),
      required_approval_scopes: unique(scopes),
      reviewer_ref: null,
      decision_ref: null,
      decision_reason: null,
      approval_is_external_authority: true
    },
    calculation: {
      calculation_engine_ref: exact.calculation_engine_ref,
      exact_money_certified: true,
      currency: exact.currency,
      total_minor: total.toString(),
      immutable_calculation_input_required_after_approval: true
    },
    details,
    policy_snapshot: {
      high_value_threshold_minor: highValueThreshold === null ? null : highValueThreshold.toString(),
      quote_variance_review_bps: varianceThresholdBps === null ? null : varianceThresholdBps.toString(),
      policy_ref: nonEmpty(policy.policy_ref) ? policy.policy_ref.trim() : null,
      review_any_discount: policy.review_any_discount === true,
      allowed_tax_modes: [...allowedTaxModes],
      allowed_tax_rate_bps: [...allowedTaxRates]
    },
    authority: {
      company_boundary: 'company_id',
      identity_grants_authority: false,
      authority_granted: false,
      grants_authority: false,
      execution_permitted: false,
      approval_decision_must_come_from_existing_titan_authority: true,
      canonical_financial_mutation_permitted: false
    }
  };
}

export function applyInvoiceReviewDecision(gate, { company_id, decision, reviewer_ref, decision_ref, reason = null } = {}) {
  if (!gate || gate.schema !== SCHEMA) throw new TypeError('valid review gate is required');
  if (!nonEmpty(company_id)) throw new TypeError('company_id is required');
  if (gate.company_id !== company_id.trim()) throw new Error('company_boundary_mismatch');
  if (!['approved', 'rejected'].includes(decision)) throw new TypeError('decision must be approved or rejected');
  if (!nonEmpty(reviewer_ref)) throw new TypeError('reviewer_ref is required');
  if (!nonEmpty(decision_ref)) throw new TypeError('decision_ref is required');
  if (!gate.review_required && decision === 'approved') {
    return { ...gate, review: { ...gate.review, state: 'not_required' } };
  }
  return {
    ...gate,
    review: {
      ...gate.review,
      state: decision,
      reviewer_ref: reviewer_ref.trim(),
      decision_ref: decision_ref.trim(),
      decision_reason: nonEmpty(reason) ? reason.trim() : null,
      approval_is_external_authority: true
    },
    authority: {
      ...gate.authority,
      authority_granted: false,
      grants_authority: false,
      execution_permitted: false,
      canonical_financial_mutation_permitted: false
    }
  };
}

export function reviewGateToContractReview(gate) {
  if (!gate || gate.schema !== SCHEMA) throw new TypeError('valid review gate is required');
  if (!REVIEW_STATES.includes(gate.review?.state)) throw new TypeError('invalid review state');
  return {
    state: gate.review.state,
    reviewer_ref: gate.review.reviewer_ref,
    reason: gate.review.decision_reason || (gate.review.reasons || []).join(', ') || null
  };
}

export { SCHEMA as INVOICE_REVIEW_GATE_SCHEMA, REVIEW_STATES as INVOICE_REVIEW_GATE_STATES };
