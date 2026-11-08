import {
  buildBookingJobLifecycleObservation,
  REVENUE_BOOKING_JOB_LIFECYCLE_SCHEMA,
} from './revenue-booking-job-lifecycle.js';
import {
  assertRevenueJourneyCompanyBoundary,
  getRevenueJourneyCanonicalOwner,
  REVENUE_JOURNEY_COMPANY_BOUNDARY,
} from './canonical-reconciliation.js';

export const REVENUE_BOOKING_JOB_ORIGIN_EVIDENCE_SCHEMA = 'titan.zero.revenue-journey.booking-job-origin-evidence/v1' as const;

const clean = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const JOB_STATES = new Set(['planned','ready','in_progress','completed','cancelled']);

export type RevenueBookingJobOriginEvidence = Readonly<{
  schema: typeof REVENUE_BOOKING_JOB_ORIGIN_EVIDENCE_SCHEMA;
  company_id: string;
  revenue_journey_id: string;
  correlation_id: string | null;
  commercial_origin: Readonly<{
    origin_stage: 'quote' | 'opportunity' | 'lead';
    origin_id: string;
    quote_id: string | null;
    opportunity_id: string | null;
    lead_id: string | null;
    source_of_truth: true;
  }>;
  booking: Readonly<{
    booking_id: string;
    event: string;
    source_domain: string;
    source_ref: string;
    canonical_owner: string;
  }>;
  job: Readonly<{
    job_id: string | null;
    state: string | null;
    source_domain: string | null;
    source_ref: string | null;
    canonical_owner: string;
    materialization_verified: boolean;
  }>;
  lifecycle_observation: Readonly<Record<string, any>>;
  evidence_refs: readonly string[];
  governance: Readonly<{
    company_boundary: typeof REVENUE_JOURNEY_COMPANY_BOUNDARY;
    projection_only: true;
    owns_booking_truth: false;
    owns_job_truth: false;
    commercial_origin_is_evidence_not_authority: true;
    identity_is_authority: false;
    authority_granted: false;
    execution_permitted: false;
    may_create_entities: false;
    may_mutate_entities: false;
    job_completion_does_not_rewrite_commercial_origin: true;
  }>;
}>;

function resolveOrigin(correlation: Readonly<Record<string, any>>) {
  const entities = correlation?.entities ?? {};
  const quoteId = clean(entities.quote_id);
  const opportunityId = clean(entities.opportunity_id);
  const leadId = clean(entities.lead_id);
  if (quoteId) return { origin_stage: 'quote' as const, origin_id: quoteId, quote_id: quoteId, opportunity_id: opportunityId, lead_id: leadId };
  if (opportunityId) return { origin_stage: 'opportunity' as const, origin_id: opportunityId, quote_id: null, opportunity_id: opportunityId, lead_id: leadId };
  if (leadId) return { origin_stage: 'lead' as const, origin_id: leadId, quote_id: null, opportunity_id: null, lead_id: leadId };
  throw new TypeError('revenue-booking-job-commercial-origin-required');
}

export function buildBookingJobCommercialOriginEvidence(input: Readonly<Record<string, any>>): RevenueBookingJobOriginEvidence {
  const companyId = assertRevenueJourneyCompanyBoundary(input as Readonly<Record<string, unknown>>);
  const bookingOwner = getRevenueJourneyCanonicalOwner('booking');
  const jobOwner = getRevenueJourneyCanonicalOwner('job');
  if (!bookingOwner || !jobOwner) throw new TypeError('revenue-booking-job-owner-unresolved');

  const bookingSourceDomain = clean(input.booking_source_domain);
  const bookingSourceRef = clean(input.booking_source_ref);
  if (!bookingSourceDomain || !bookingSourceRef) throw new TypeError('revenue-booking-job-booking-source-required');
  if (bookingSourceDomain !== bookingOwner.sourceDomain) throw new TypeError('revenue-booking-job-booking-source-domain-mismatch');

  const jobId = clean(input.job_id);
  const jobState = clean(input.job_state);
  const jobSourceDomain = clean(input.job_source_domain);
  const jobSourceRef = clean(input.job_source_ref);
  if (jobState && !JOB_STATES.has(jobState)) throw new TypeError('revenue-booking-job-job-state-invalid');
  if (jobId && (!jobSourceDomain || !jobSourceRef)) throw new TypeError('revenue-booking-job-job-source-required');
  if (!jobId && (jobSourceDomain || jobSourceRef || jobState)) throw new TypeError('revenue-booking-job-job-id-required-for-job-evidence');
  if (jobSourceDomain && jobSourceDomain !== jobOwner.sourceDomain) throw new TypeError('revenue-booking-job-job-source-domain-mismatch');
  if (jobState === 'completed' && input.job_completion_verified !== true) throw new TypeError('revenue-booking-job-job-completion-verification-required');

  const lifecycle = buildBookingJobLifecycleObservation({
    ...input,
    company_id: companyId,
    job_materialization_verified: jobId ? input.job_materialization_verified === true : false,
  });
  if (lifecycle.schema !== REVENUE_BOOKING_JOB_LIFECYCLE_SCHEMA) throw new TypeError('revenue-booking-job-lifecycle-schema-invalid');
  if (lifecycle.company_id !== companyId) throw new TypeError('revenue-booking-job-cross-company-lifecycle');

  const origin = resolveOrigin(lifecycle.correlation);
  const bookingEvent = lifecycle.booking_event;
  if (!bookingEvent) throw new TypeError('revenue-booking-job-booking-event-required');

  const evidenceRefs = Object.freeze([
    ...((lifecycle.evidence ?? []).map((item: any) => clean(item?.source_ref)).filter((value: string | null): value is string => Boolean(value))),
    bookingSourceRef,
    ...(jobSourceRef ? [jobSourceRef] : []),
  ].filter((value, index, values) => values.indexOf(value) === index));

  return Object.freeze({
    schema: REVENUE_BOOKING_JOB_ORIGIN_EVIDENCE_SCHEMA,
    company_id: companyId,
    revenue_journey_id: lifecycle.revenue_journey_id,
    correlation_id: clean(lifecycle.correlation?.correlation_id),
    commercial_origin: Object.freeze({ ...origin, source_of_truth: true as const }),
    booking: Object.freeze({
      booking_id: lifecycle.booking_id,
      event: bookingEvent,
      source_domain: bookingSourceDomain,
      source_ref: bookingSourceRef,
      canonical_owner: bookingOwner.canonicalOwner,
    }),
    job: Object.freeze({
      job_id: jobId,
      state: jobState,
      source_domain: jobSourceDomain,
      source_ref: jobSourceRef,
      canonical_owner: jobOwner.canonicalOwner,
      materialization_verified: jobId ? input.job_materialization_verified === true : false,
    }),
    lifecycle_observation: lifecycle,
    evidence_refs: evidenceRefs,
    governance: Object.freeze({
      company_boundary: REVENUE_JOURNEY_COMPANY_BOUNDARY,
      projection_only: true,
      owns_booking_truth: false,
      owns_job_truth: false,
      commercial_origin_is_evidence_not_authority: true,
      identity_is_authority: false,
      authority_granted: false,
      execution_permitted: false,
      may_create_entities: false,
      may_mutate_entities: false,
      job_completion_does_not_rewrite_commercial_origin: true,
    }),
  });
}

export function assertBookingJobOriginReplay(a: RevenueBookingJobOriginEvidence, b: RevenueBookingJobOriginEvidence): boolean {
  return a.company_id === b.company_id
    && a.revenue_journey_id === b.revenue_journey_id
    && a.booking.booking_id === b.booking.booking_id
    && a.booking.event === b.booking.event
    && a.job.job_id === b.job.job_id
    && a.job.state === b.job.state
    && a.commercial_origin.origin_stage === b.commercial_origin.origin_stage
    && a.commercial_origin.origin_id === b.commercial_origin.origin_id
    && a.lifecycle_observation.idempotency_key === b.lifecycle_observation.idempotency_key;
}
