const SCHEMA = 'titan.workforce.starter.invoicing.exact-money.v1';
const ENGINE_REF = 'titan-invoicing-exact-money-v1';

function nonEmpty(v) { return typeof v === 'string' && v.trim().length > 0; }
function intBig(v, name, { min = null } = {}) {
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new TypeError(`${name} must be a safe integer minor-unit/basis-point value`);
    v = String(v);
  }
  if (typeof v !== 'string' || !/^-?\d+$/.test(v.trim())) throw new TypeError(`${name} must be an integer string or safe integer`);
  const n = BigInt(v.trim());
  if (min !== null && n < BigInt(min)) throw new RangeError(`${name} must be >= ${min}`);
  return n;
}
function divRoundHalfUp(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  const sign = numerator < 0n ? -1n : 1n;
  const abs = numerator < 0n ? -numerator : numerator;
  const q = abs / denominator;
  const r = abs % denominator;
  return sign * (q + (r * 2n >= denominator ? 1n : 0n));
}
function bpsAmount(base, bps) { return divRoundHalfUp(base * bps, 10000n); }
function asMinor(n) { return n.toString(); }
function refs(v) { return Array.isArray(v) ? v.filter(nonEmpty).map(x => x.trim()) : []; }

function computeDiscount(base, discount = {}, label = 'discount') {
  const hasAbs = discount.amount_minor !== undefined && discount.amount_minor !== null;
  const hasRate = discount.rate_bps !== undefined && discount.rate_bps !== null;
  if (hasAbs && hasRate) throw new TypeError(`${label} cannot specify both amount_minor and rate_bps`);
  if (!hasAbs && !hasRate) return { amount: 0n, kind: 'none', basis_ref: null };
  if (!nonEmpty(discount.basis_ref)) throw new TypeError(`${label}.basis_ref is required`);
  let amount;
  let kind;
  if (hasAbs) { amount = intBig(discount.amount_minor, `${label}.amount_minor`, { min: 0 }); kind = 'absolute_minor'; }
  else {
    const rate = intBig(discount.rate_bps, `${label}.rate_bps`, { min: 0 });
    if (rate > 10000n) throw new RangeError(`${label}.rate_bps must be <= 10000`);
    amount = bpsAmount(base, rate); kind = 'basis_points';
  }
  if (amount > base) throw new RangeError(`${label} cannot exceed its base`);
  return { amount, kind, basis_ref: discount.basis_ref.trim() };
}

export function calculateExactInvoice({ company_id, currency, line_items = [], invoice_discount = null, tax = {}, provenance = {} } = {}) {
  if (!nonEmpty(company_id)) throw new TypeError('company_id is required');
  if (!nonEmpty(currency) || !/^[A-Za-z]{3}$/.test(currency.trim())) throw new TypeError('currency must be a 3-letter code');
  if (!Array.isArray(line_items) || line_items.length === 0) throw new TypeError('line_items must contain at least one item');
  const pricingRefs = refs(provenance.pricing_source_refs);
  if (pricingRefs.length === 0) throw new TypeError('provenance.pricing_source_refs is required');
  if (!nonEmpty(provenance.tax_basis_ref)) throw new TypeError('provenance.tax_basis_ref is required');
  const company = company_id.trim();
  const seen = new Set();
  let subtotal = 0n;
  let lineDiscountTotal = 0n;
  const computed = [];

  for (const [idx, raw] of line_items.entries()) {
    if (!raw || typeof raw !== 'object') throw new TypeError(`line_items[${idx}] must be an object`);
    if (nonEmpty(raw.company_id) && raw.company_id.trim() !== company) throw new Error('company_boundary_mismatch');
    if (!nonEmpty(raw.line_ref)) throw new TypeError(`line_items[${idx}].line_ref is required`);
    const lineRef = raw.line_ref.trim();
    if (seen.has(lineRef)) throw new Error(`duplicate_line_ref:${lineRef}`);
    seen.add(lineRef);
    if (!nonEmpty(raw.pricing_source_ref)) throw new TypeError(`line_items[${idx}].pricing_source_ref is required`);
    const qty = intBig(raw.quantity, `line_items[${idx}].quantity`, { min: 1 });
    const unit = intBig(raw.unit_amount_minor, `line_items[${idx}].unit_amount_minor`, { min: 0 });
    const gross = qty * unit;
    const disc = computeDiscount(gross, raw.discount || {}, `line_items[${idx}].discount`);
    const net = gross - disc.amount;
    subtotal += net;
    lineDiscountTotal += disc.amount;
    computed.push({
      line_ref: lineRef,
      description_ref: nonEmpty(raw.description_ref) ? raw.description_ref.trim() : null,
      pricing_source_ref: raw.pricing_source_ref.trim(),
      quantity: qty.toString(), unit_amount_minor: asMinor(unit), gross_minor: asMinor(gross),
      discount_minor: asMinor(disc.amount), discount_kind: disc.kind, discount_basis_ref: disc.basis_ref,
      net_minor: asMinor(net)
    });
  }

  const invDisc = computeDiscount(subtotal, invoice_discount || {}, 'invoice_discount');
  const taxableBase = subtotal - invDisc.amount;
  const taxMode = nonEmpty(tax.mode) ? tax.mode.trim().toLowerCase() : 'exclusive';
  let taxAmount = 0n;
  let taxRateBps = 0n;
  if (taxMode === 'exclusive') {
    taxRateBps = intBig(tax.rate_bps, 'tax.rate_bps', { min: 0 });
    if (taxRateBps > 100000n) throw new RangeError('tax.rate_bps is unreasonably high');
    taxAmount = bpsAmount(taxableBase, taxRateBps);
  } else if (!['zero', 'exempt'].includes(taxMode)) {
    throw new TypeError('tax.mode must be exclusive, zero, or exempt');
  }
  const total = taxableBase + taxAmount;

  const reconciliation = computed.reduce((s, l) => s + BigInt(l.net_minor), 0n);
  if (reconciliation !== subtotal) throw new Error('line_reconciliation_failed');
  if (subtotal - invDisc.amount + taxAmount !== total) throw new Error('invoice_reconciliation_failed');

  return {
    schema: SCHEMA,
    company_id: company,
    currency: currency.trim().toUpperCase(),
    calculation_engine_ref: ENGINE_REF,
    exact_money_certified: true,
    arithmetic: { representation: 'integer_minor_units', percentage_representation: 'integer_basis_points', binary_float_used: false, rounding_policy: 'HALF_UP_TO_MINOR_UNIT' },
    line_items: computed,
    totals: {
      subtotal_after_line_discounts_minor: asMinor(subtotal),
      line_discounts_minor: asMinor(lineDiscountTotal),
      invoice_discount_minor: asMinor(invDisc.amount),
      taxable_base_minor: asMinor(taxableBase),
      tax_minor: asMinor(taxAmount),
      total_minor: asMinor(total)
    },
    tax: { mode: taxMode, rate_bps: taxRateBps.toString(), tax_basis_ref: provenance.tax_basis_ref.trim() },
    invoice_discount: { kind: invDisc.kind, basis_ref: invDisc.basis_ref },
    provenance: { pricing_source_refs: pricingRefs, tax_basis_ref: provenance.tax_basis_ref.trim(), quote_or_contract_ref: nonEmpty(provenance.quote_or_contract_ref) ? provenance.quote_or_contract_ref.trim() : null, actuals_ref: nonEmpty(provenance.actuals_ref) ? provenance.actuals_ref.trim() : null },
    reconciliation: { line_sum_matches_subtotal: true, subtotal_discount_tax_matches_total: true },
    authority: { company_boundary: 'company_id', identity_grants_authority: false, authority_granted: false, grants_authority: false, execution_permitted: false, canonical_mutation_permitted: false }
  };
}

export function exactMoneyToCalculationBasis(result) {
  if (!result || result.schema !== SCHEMA || result.exact_money_certified !== true) throw new TypeError('certified exact-money result is required');
  return {
    currency: result.currency,
    pricing_source_refs: [...result.provenance.pricing_source_refs],
    quote_or_contract_ref: result.provenance.quote_or_contract_ref,
    actuals_ref: result.provenance.actuals_ref,
    tax_basis_ref: result.provenance.tax_basis_ref,
    discount_basis_refs: result.line_items.map(x => x.discount_basis_ref).filter(Boolean).concat(result.invoice_discount.basis_ref ? [result.invoice_discount.basis_ref] : []),
    exact_money_certified: true,
    calculation_engine_ref: result.calculation_engine_ref,
    totals_minor: { ...result.totals },
    reconciliation: { ...result.reconciliation }
  };
}

export { SCHEMA as EXACT_MONEY_SCHEMA, ENGINE_REF as EXACT_MONEY_ENGINE_REF };
