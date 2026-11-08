import {
  buildQuoteLifecycleTransition,
  REVENUE_QUOTE_LIFECYCLE_SCHEMA,
} from './revenue-quote-lifecycle.js';
import {
  assertRevenueJourneyCompanyBoundary,
  getRevenueJourneyCanonicalOwner,
  REVENUE_JOURNEY_COMPANY_BOUNDARY,
} from './canonical-reconciliation.js';

export const REVENUE_QUOTE_EVIDENCE_SCHEMA = 'titan.zero.revenue-journey.quote-evidence/v1' as const;

export type RevenueQuoteJourneyState = 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'superseded';

const JOURNEY_STATES = new Set<RevenueQuoteJourneyState>(['draft','sent','viewed','accepted','declined','expired','superseded']);
const LEGAL: Readonly<Record<RevenueQuoteJourneyState, ReadonlySet<RevenueQuoteJourneyState>>> = Object.freeze({
  draft: new Set<RevenueQuoteJourneyState>(['draft','sent','superseded']),
  sent: new Set<RevenueQuoteJourneyState>(['sent','viewed','accepted','declined','expired','superseded']),
  viewed: new Set<RevenueQuoteJourneyState>(['viewed','accepted','declined','expired','superseded']),
  accepted: new Set<RevenueQuoteJourneyState>(['accepted']),
  declined: new Set<RevenueQuoteJourneyState>(['declined']),
  expired: new Set<RevenueQuoteJourneyState>(['expired']),
  superseded: new Set<RevenueQuoteJourneyState>(['superseded']),
});

const CANONICAL_STATE: Readonly<Record<RevenueQuoteJourneyState, string>> = Object.freeze({
  draft: 'draft',
  sent: 'issued',
  viewed: 'issued',
  accepted: 'accepted',
  declined: 'rejected',
  expired: 'expired',
  superseded: 'cancelled',
});

const clean = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

export type RevenueQuoteLifecycleEvidence = Readonly<{
  schema: typeof REVENUE_QUOTE_EVIDENCE_SCHEMA;
  company_id: string;
  revenue_journey_id: string;
  correlation_id: string | null;
  quote_id: string;
  journey_transition: Readonly<{
    from_state: RevenueQuoteJourneyState;
    to_state: RevenueQuoteJourneyState;
    disposition: 'transition_observed' | 'idempotent_replay';
    terminal: boolean;
  }>;
  canonical_transition: Readonly<{
    lifecycle_schema: typeof REVENUE_QUOTE_LIFECYCLE_SCHEMA;
    from_state: string;
    to_state: string;
    disposition: string;
    canonical_reason: string | null;
  }>;
  source: Readonly<{
    source_domain: string;
    source_ref: string;
    producer: string;
    source_event_id: string;
    observed_at: string | null;
  }>;
  evidence_refs: readonly string[];
  lifecycle_event: Readonly<Record<string, unknown>>;
  governance: Readonly<{
    company_boundary: typeof REVENUE_JOURNEY_COMPANY_BOUNDARY;
    quote_truth_owner: string;
    source_of_truth: true;
    projection_owns_truth: false;
    identity_is_authority: false;
    authority_granted: false;
    execution_permitted: false;
    may_create_entities: false;
    may_mutate_entities: false;
    viewed_is_observation_only: true;
    accepted_is_not_booking_completion: true;
    superseded_requires_canonical_cancelled_evidence: true;
  }>;
}>;

export function buildQuoteLifecycleEvidence(input: Readonly<Record<string, any>>): RevenueQuoteLifecycleEvidence {
  const companyId = assertRevenueJourneyCompanyBoundary(input as Readonly<Record<string, unknown>>);
  const fromJourney = clean(input.from_journey_state ?? input.from_state) as RevenueQuoteJourneyState | null;
  const toJourney = clean(input.to_journey_state ?? input.to_state) as RevenueQuoteJourneyState | null;
  if (!fromJourney || !JOURNEY_STATES.has(fromJourney) || !toJourney || !JOURNEY_STATES.has(toJourney)) {
    throw new TypeError('revenue-quote-evidence-state-invalid');
  }
  if (!LEGAL[fromJourney].has(toJourney)) {
    throw new TypeError(`revenue-quote-evidence-transition-invalid:${fromJourney}->${toJourney}`);
  }

  const owner = getRevenueJourneyCanonicalOwner('quote');
  if (!owner) throw new TypeError('revenue-quote-evidence-owner-unresolved');
  const sourceDomain = clean(input.source_domain);
  const sourceRef = clean(input.source_ref);
  if (!sourceDomain || !sourceRef) throw new TypeError('revenue-quote-evidence-source-required');
  if (sourceDomain !== owner.sourceDomain) throw new TypeError('revenue-quote-evidence-source-domain-mismatch');

  const canonicalFrom = CANONICAL_STATE[fromJourney];
  const canonicalTo = CANONICAL_STATE[toJourney];
  const canonicalReason = clean(input.canonical_reason);
  if ((fromJourney === 'superseded' || toJourney === 'superseded') && canonicalReason !== 'superseded') {
    throw new TypeError('revenue-quote-evidence-superseded-reason-required');
  }

  const lifecycleEvent = buildQuoteLifecycleTransition({
    ...input,
    company_id: companyId,
    from_state: canonicalFrom,
    to_state: canonicalTo,
  });
  if (lifecycleEvent.company_id !== companyId) throw new TypeError('revenue-quote-evidence-cross-company-lifecycle');

  const canonicalFromState = lifecycleEvent.transition.from_state;
  const canonicalToState = lifecycleEvent.transition.to_state;
  if (!canonicalFromState || !canonicalToState) throw new TypeError('revenue-quote-evidence-canonical-state-required');

  const producer = clean(lifecycleEvent.provenance?.producer);
  const sourceEventId = clean(lifecycleEvent.provenance?.source_event_id);
  const observedAt = clean(lifecycleEvent.provenance?.observed_at);
  const evidenceRefs = Object.freeze((lifecycleEvent.evidence ?? [])
    .map((item: any) => clean(item?.source_ref))
    .filter((value: string | null): value is string => Boolean(value)));
  if (!producer || !sourceEventId || !evidenceRefs.length) throw new TypeError('revenue-quote-evidence-lifecycle-provenance-invalid');

  return Object.freeze({
    schema: REVENUE_QUOTE_EVIDENCE_SCHEMA,
    company_id: companyId,
    revenue_journey_id: lifecycleEvent.revenue_journey_id,
    correlation_id: clean(lifecycleEvent.correlation?.correlation_id),
    quote_id: lifecycleEvent.quote_id,
    journey_transition: Object.freeze({
      from_state: fromJourney,
      to_state: toJourney,
      disposition: fromJourney === toJourney ? 'idempotent_replay' : 'transition_observed',
      terminal: new Set(['accepted','declined','expired','superseded']).has(toJourney),
    }),
    canonical_transition: Object.freeze({
      lifecycle_schema: REVENUE_QUOTE_LIFECYCLE_SCHEMA,
      from_state: canonicalFromState,
      to_state: canonicalToState,
      disposition: lifecycleEvent.transition.disposition,
      canonical_reason: canonicalReason,
    }),
    source: Object.freeze({
      source_domain: sourceDomain,
      source_ref: sourceRef,
      producer,
      source_event_id: sourceEventId,
      observed_at: observedAt,
    }),
    evidence_refs: evidenceRefs,
    lifecycle_event: lifecycleEvent,
    governance: Object.freeze({
      company_boundary: REVENUE_JOURNEY_COMPANY_BOUNDARY,
      quote_truth_owner: owner.canonicalOwner,
      source_of_truth: true,
      projection_owns_truth: false,
      identity_is_authority: false,
      authority_granted: false,
      execution_permitted: false,
      may_create_entities: false,
      may_mutate_entities: false,
      viewed_is_observation_only: true,
      accepted_is_not_booking_completion: true,
      superseded_requires_canonical_cancelled_evidence: true,
    }),
  });
}

export function assertQuoteEvidenceReplay(a: RevenueQuoteLifecycleEvidence, b: RevenueQuoteLifecycleEvidence): boolean {
  return a.company_id === b.company_id
    && a.revenue_journey_id === b.revenue_journey_id
    && a.quote_id === b.quote_id
    && a.source.source_event_id === b.source.source_event_id
    && a.source.source_ref === b.source.source_ref
    && a.journey_transition.from_state === b.journey_transition.from_state
    && a.journey_transition.to_state === b.journey_transition.to_state
    && a.canonical_transition.canonical_reason === b.canonical_transition.canonical_reason;
}
