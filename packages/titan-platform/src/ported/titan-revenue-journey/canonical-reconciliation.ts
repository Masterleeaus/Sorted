import { REVENUE_JOURNEY_CORRELATION_SCHEMA } from './revenue-journey-correlation.js';

export const REVENUE_JOURNEY_CANONICAL_RECONCILIATION_SCHEMA = 'titan.zero.revenue-journey.canonical-reconciliation/v1' as const;
export const REVENUE_JOURNEY_COMPANY_BOUNDARY = 'company_id' as const;

export type RevenueJourneyCanonicalStage =
  | 'lead'
  | 'opportunity'
  | 'quote'
  | 'booking'
  | 'job'
  | 'invoice'
  | 'payment'
  | 'repeat'
  | 'referral';

export type RevenueJourneyCanonicalOwner = Readonly<{
  stage: RevenueJourneyCanonicalStage;
  canonicalOwner: string;
  sourceDomain: string;
  canonicalSurfaces: readonly string[];
  sourceOfTruth: true;
  journeyProjectionOwnsTruth: false;
}>;

export const REVENUE_JOURNEY_CANONICAL_OWNERS = Object.freeze([
  Object.freeze({ stage: 'lead', canonicalOwner: 'Titan CRM', sourceDomain: 'crm.leads', canonicalSurfaces: Object.freeze(['/api/v1/leads']), sourceOfTruth: true, journeyProjectionOwnsTruth: false }),
  Object.freeze({ stage: 'opportunity', canonicalOwner: 'Titan CRM', sourceDomain: 'crm.opportunities', canonicalSurfaces: Object.freeze(['/api/v1/opportunities']), sourceOfTruth: true, journeyProjectionOwnsTruth: false }),
  Object.freeze({ stage: 'quote', canonicalOwner: 'Titan CRM', sourceDomain: 'crm.quotes', canonicalSurfaces: Object.freeze(['/api/v1/estimates']), sourceOfTruth: true, journeyProjectionOwnsTruth: false }),
  Object.freeze({ stage: 'booking', canonicalOwner: 'CRM revenue journey + Titan Bookings/Quotes lifecycle engine', sourceDomain: 'crm.bookings', canonicalSurfaces: Object.freeze(['/api/v1/booking-requests']), sourceOfTruth: true, journeyProjectionOwnsTruth: false }),
  Object.freeze({ stage: 'job', canonicalOwner: 'Titan Field', sourceDomain: 'field.work-orders', canonicalSurfaces: Object.freeze(['/api/v1/work-orders']), sourceOfTruth: true, journeyProjectionOwnsTruth: false }),
  Object.freeze({ stage: 'invoice', canonicalOwner: 'Titan CRM revenue document authority', sourceDomain: 'crm.invoices', canonicalSurfaces: Object.freeze(['/api/v1/invoices']), sourceOfTruth: true, journeyProjectionOwnsTruth: false }),
  Object.freeze({ stage: 'payment', canonicalOwner: 'Titan CRM receivable/payment lifecycle pending dedicated Titan Pay master', sourceDomain: 'finance.payments', canonicalSurfaces: Object.freeze(['/api/v1/invoices/[id]/payments', '/api/v1/payments/[id]']), sourceOfTruth: true, journeyProjectionOwnsTruth: false }),
  Object.freeze({ stage: 'repeat', canonicalOwner: 'Rebooking/Booking canonical domains', sourceDomain: 'customer.rebooking', canonicalSurfaces: Object.freeze(['/api/v1/booking-requests']), sourceOfTruth: true, journeyProjectionOwnsTruth: false }),
  Object.freeze({ stage: 'referral', canonicalOwner: 'CRM/customer acquisition canonical domains', sourceDomain: 'crm.customer-acquisition', canonicalSurfaces: Object.freeze(['/api/v1/leads']), sourceOfTruth: true, journeyProjectionOwnsTruth: false }),
] as const satisfies readonly RevenueJourneyCanonicalOwner[]);

const OWNER_BY_STAGE = new Map<RevenueJourneyCanonicalStage, RevenueJourneyCanonicalOwner>(
  REVENUE_JOURNEY_CANONICAL_OWNERS.map((entry) => [entry.stage, entry])
);

const LEGACY_COMPANY_KEYS = ['tenant_id', 'tenantId', 'tenant_company_id', 'business_id', 'account_id'] as const;
const clean = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

export function getRevenueJourneyCanonicalOwner(stage: string): RevenueJourneyCanonicalOwner | null {
  return OWNER_BY_STAGE.get(stage as RevenueJourneyCanonicalStage) ?? null;
}

export function assertRevenueJourneyCompanyBoundary(input: Readonly<Record<string, unknown>>): string {
  for (const key of LEGACY_COMPANY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key] != null) {
      throw new TypeError(`revenue-journey-legacy-company-boundary-forbidden:${key}`);
    }
  }
  const companyId = clean(input.company_id);
  if (!companyId) throw new TypeError('revenue-journey-company-id-required');
  return companyId;
}

export type RevenueJourneyCanonicalObservation = Readonly<{
  stage: RevenueJourneyCanonicalStage;
  entity_id: string;
  state: string;
  source_domain: string;
  source_ref: string;
  observed_at?: string | null;
}>;

export type RevenueJourneyCanonicalReconciliation = Readonly<{
  schema: typeof REVENUE_JOURNEY_CANONICAL_RECONCILIATION_SCHEMA;
  company_id: string;
  revenue_journey_id: string;
  correlation_id: string | null;
  observations: readonly Readonly<RevenueJourneyCanonicalObservation & { canonical_owner: RevenueJourneyCanonicalOwner }>[];
  governance: Readonly<{
    company_boundary: typeof REVENUE_JOURNEY_COMPANY_BOUNDARY;
    is_derived_projection: true;
    owns_domain_truth: false;
    may_mutate_domain_records: false;
    identity_is_authority: false;
    execution_permitted: false;
  }>;
}>;

export function buildRevenueJourneyCanonicalReconciliation(input: Readonly<{
  company_id: string;
  correlation: Readonly<Record<string, unknown>>;
  observations: readonly RevenueJourneyCanonicalObservation[];
}>): RevenueJourneyCanonicalReconciliation {
  const companyId = assertRevenueJourneyCompanyBoundary(input as unknown as Readonly<Record<string, unknown>>);
  const correlation = input.correlation;
  if (!correlation || correlation.schema !== REVENUE_JOURNEY_CORRELATION_SCHEMA) {
    throw new TypeError('revenue-journey-valid-correlation-required');
  }
  if (correlation.company_id !== companyId) throw new TypeError('revenue-journey-cross-company-correlation');
  const revenueJourneyId = clean(correlation.revenue_journey_id);
  if (!revenueJourneyId) throw new TypeError('revenue-journey-id-required');

  const observations = Object.freeze((input.observations ?? []).map((observation, index) => {
    const owner = getRevenueJourneyCanonicalOwner(observation.stage);
    if (!owner) throw new TypeError(`revenue-journey-stage-owner-unresolved:${String(observation.stage)}`);
    const entityId = clean(observation.entity_id);
    const state = clean(observation.state);
    const sourceDomain = clean(observation.source_domain);
    const sourceRef = clean(observation.source_ref);
    if (!entityId || !state || !sourceDomain || !sourceRef) throw new TypeError(`revenue-journey-observation-invalid:${index}`);
    if (sourceDomain !== owner.sourceDomain) {
      throw new TypeError(`revenue-journey-source-domain-mismatch:${observation.stage}`);
    }
    return Object.freeze({
      stage: observation.stage,
      entity_id: entityId,
      state,
      source_domain: sourceDomain,
      source_ref: sourceRef,
      observed_at: clean(observation.observed_at),
      canonical_owner: owner,
    });
  }));

  return Object.freeze({
    schema: REVENUE_JOURNEY_CANONICAL_RECONCILIATION_SCHEMA,
    company_id: companyId,
    revenue_journey_id: revenueJourneyId,
    correlation_id: clean(correlation.correlation_id),
    observations,
    governance: Object.freeze({
      company_boundary: REVENUE_JOURNEY_COMPANY_BOUNDARY,
      is_derived_projection: true,
      owns_domain_truth: false,
      may_mutate_domain_records: false,
      identity_is_authority: false,
      execution_permitted: false,
    }),
  });
}
