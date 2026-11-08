import {
  buildInvoicePaymentLifecycleObservation,
  REVENUE_INVOICE_PAYMENT_LIFECYCLE_SCHEMA,
} from './revenue-invoice-payment-lifecycle.js';
import {
  assertRevenueJourneyCompanyBoundary,
  getRevenueJourneyCanonicalOwner,
  REVENUE_JOURNEY_COMPANY_BOUNDARY,
} from './canonical-reconciliation.js';

export const REVENUE_INVOICE_PAYMENT_EVIDENCE_SCHEMA = 'titan.zero.revenue-journey.invoice-payment-evidence/v1' as const;

export type RevenueInvoicePaymentOutcome =
  | 'open'
  | 'partial'
  | 'overdue'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'reconciled'
  | 'disputed'
  | 'void';

const clean = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

function resolveUpstreamOrigin(correlation: Readonly<Record<string, any>>) {
  const entities = correlation?.entities ?? {};
  const stages = ['job', 'booking', 'quote', 'opportunity', 'lead'] as const;
  for (const stage of stages) {
    const id = clean(entities[`${stage}_id`]);
    if (id) return Object.freeze({ stage, entity_id: id });
  }
  throw new TypeError('revenue-invoice-payment-commercial-origin-required');
}

function classifyOutcome(lifecycle: Readonly<Record<string, any>>, reconciliationVerified: boolean): RevenueInvoicePaymentOutcome {
  const invoiceState = clean(lifecycle.invoice_state);
  const paymentState = clean(lifecycle.payment_state);
  if (paymentState === 'settled' && reconciliationVerified) return 'reconciled';
  if (paymentState === 'failed') return 'failed';
  if (paymentState === 'refunded' || paymentState === 'partially_refunded') return 'refunded';
  if (paymentState === 'partial' || invoiceState === 'partially_paid') return 'partial';
  if (invoiceState === 'overdue') return 'overdue';
  if (invoiceState === 'paid' || paymentState === 'settled') return 'paid';
  if (invoiceState === 'disputed' || paymentState === 'disputed') return 'disputed';
  if (invoiceState === 'void' || paymentState === 'cancelled') return 'void';
  return 'open';
}

export type RevenueInvoicePaymentEvidence = Readonly<{
  schema: typeof REVENUE_INVOICE_PAYMENT_EVIDENCE_SCHEMA;
  company_id: string;
  revenue_journey_id: string;
  correlation_id: string | null;
  upstream_origin: Readonly<{ stage: 'job' | 'booking' | 'quote' | 'opportunity' | 'lead'; entity_id: string }>;
  invoice: Readonly<{
    invoice_id: string;
    state: string;
    source_domain: string;
    source_ref: string;
    canonical_owner: string;
  }>;
  payment: Readonly<{
    payment_id: string | null;
    state: string | null;
    source_domain: string | null;
    source_ref: string | null;
    canonical_owner: string;
    reconciliation_verified: boolean;
  }>;
  outcome: RevenueInvoicePaymentOutcome;
  amounts: Readonly<{ total: number; paid: number; refunded: number; outstanding: number }>;
  lifecycle_observation: Readonly<Record<string, any>>;
  evidence_refs: readonly string[];
  governance: Readonly<{
    company_boundary: typeof REVENUE_JOURNEY_COMPANY_BOUNDARY;
    projection_only: true;
    owns_invoice_truth: false;
    owns_payment_truth: false;
    settlement_is_evidence_not_authority: true;
    reconciliation_requires_explicit_verification: true;
    identity_is_authority: false;
    authority_granted: false;
    execution_permitted: false;
    may_move_money: false;
    may_refund: false;
    may_create_entities: false;
    may_mutate_entities: false;
  }>;
}>;

export function buildInvoicePaymentJourneyEvidence(input: Readonly<Record<string, any>>): RevenueInvoicePaymentEvidence {
  const companyId = assertRevenueJourneyCompanyBoundary(input as Readonly<Record<string, unknown>>);
  const invoiceOwner = getRevenueJourneyCanonicalOwner('invoice');
  const paymentOwner = getRevenueJourneyCanonicalOwner('payment');
  if (!invoiceOwner || !paymentOwner) throw new TypeError('revenue-invoice-payment-owner-unresolved');

  const invoiceSourceDomain = clean(input.invoice_source_domain);
  const invoiceSourceRef = clean(input.invoice_source_ref);
  if (!invoiceSourceDomain || !invoiceSourceRef) throw new TypeError('revenue-invoice-payment-invoice-source-required');
  if (invoiceSourceDomain !== invoiceOwner.sourceDomain) throw new TypeError('revenue-invoice-payment-invoice-source-domain-mismatch');

  const paymentId = clean(input.payment_id);
  const paymentSourceDomain = clean(input.payment_source_domain);
  const paymentSourceRef = clean(input.payment_source_ref);
  if (paymentId && (!paymentSourceDomain || !paymentSourceRef)) throw new TypeError('revenue-invoice-payment-payment-source-required');
  if (!paymentId && (paymentSourceDomain || paymentSourceRef)) throw new TypeError('revenue-invoice-payment-payment-id-required-for-source');
  if (paymentSourceDomain && paymentSourceDomain !== paymentOwner.sourceDomain) throw new TypeError('revenue-invoice-payment-payment-source-domain-mismatch');

  const lifecycle = buildInvoicePaymentLifecycleObservation({ ...input, company_id: companyId });
  if (lifecycle.schema !== REVENUE_INVOICE_PAYMENT_LIFECYCLE_SCHEMA) throw new TypeError('revenue-invoice-payment-lifecycle-schema-invalid');
  if (lifecycle.company_id !== companyId) throw new TypeError('revenue-invoice-payment-cross-company-lifecycle');

  const invoiceState = lifecycle.invoice_state;
  if (!invoiceState) throw new TypeError('revenue-invoice-payment-invoice-state-required');

  const reconciliationVerified = input.reconciliation_verified === true;
  const paymentState = clean(lifecycle.payment_state);
  if (reconciliationVerified && paymentState !== 'settled') {
    throw new TypeError('revenue-invoice-payment-reconciliation-requires-settled-payment');
  }
  if (input.outcome === 'reconciled' && !reconciliationVerified) {
    throw new TypeError('revenue-invoice-payment-reconciliation-verification-required');
  }

  const outcome = classifyOutcome(lifecycle, reconciliationVerified);
  const requestedOutcome = clean(input.outcome);
  if (requestedOutcome && requestedOutcome !== outcome) {
    throw new TypeError(`revenue-invoice-payment-outcome-mismatch:${requestedOutcome}:${outcome}`);
  }

  const upstreamOrigin = resolveUpstreamOrigin(lifecycle.correlation);
  const evidenceRefs = Object.freeze([
    ...((lifecycle.evidence ?? []).map((item: any) => clean(item?.source_ref)).filter((value: string | null): value is string => Boolean(value))),
    invoiceSourceRef,
    ...(paymentSourceRef ? [paymentSourceRef] : []),
    ...(reconciliationVerified ? [clean(input.reconciliation_evidence_ref)] : []),
  ].filter((value): value is string => Boolean(value)).filter((value, index, values) => values.indexOf(value) === index));

  if (reconciliationVerified && !clean(input.reconciliation_evidence_ref)) {
    throw new TypeError('revenue-invoice-payment-reconciliation-evidence-required');
  }

  return Object.freeze({
    schema: REVENUE_INVOICE_PAYMENT_EVIDENCE_SCHEMA,
    company_id: companyId,
    revenue_journey_id: lifecycle.revenue_journey_id,
    correlation_id: clean(lifecycle.correlation?.correlation_id),
    upstream_origin: upstreamOrigin,
    invoice: Object.freeze({
      invoice_id: lifecycle.invoice_id,
      state: invoiceState,
      source_domain: invoiceSourceDomain,
      source_ref: invoiceSourceRef,
      canonical_owner: invoiceOwner.canonicalOwner,
    }),
    payment: Object.freeze({
      payment_id: paymentId,
      state: paymentState,
      source_domain: paymentSourceDomain,
      source_ref: paymentSourceRef,
      canonical_owner: paymentOwner.canonicalOwner,
      reconciliation_verified: reconciliationVerified,
    }),
    outcome,
    amounts: Object.freeze({ ...lifecycle.amounts }),
    lifecycle_observation: lifecycle,
    evidence_refs: evidenceRefs,
    governance: Object.freeze({
      company_boundary: REVENUE_JOURNEY_COMPANY_BOUNDARY,
      projection_only: true,
      owns_invoice_truth: false,
      owns_payment_truth: false,
      settlement_is_evidence_not_authority: true,
      reconciliation_requires_explicit_verification: true,
      identity_is_authority: false,
      authority_granted: false,
      execution_permitted: false,
      may_move_money: false,
      may_refund: false,
      may_create_entities: false,
      may_mutate_entities: false,
    }),
  });
}

export function assertInvoicePaymentEvidenceReplay(a: RevenueInvoicePaymentEvidence, b: RevenueInvoicePaymentEvidence): boolean {
  return a.company_id === b.company_id
    && a.revenue_journey_id === b.revenue_journey_id
    && a.invoice.invoice_id === b.invoice.invoice_id
    && a.payment.payment_id === b.payment.payment_id
    && a.invoice.state === b.invoice.state
    && a.payment.state === b.payment.state
    && a.outcome === b.outcome
    && a.lifecycle_observation.idempotency_key === b.lifecycle_observation.idempotency_key;
}
