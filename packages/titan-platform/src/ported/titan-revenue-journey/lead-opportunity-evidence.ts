import {
  buildLeadOpportunityLifecycleTransition,
  REVENUE_LEAD_OPPORTUNITY_LIFECYCLE_SCHEMA,
} from './revenue-lead-opportunity-lifecycle.js';
import {
  assertRevenueJourneyCompanyBoundary,
  getRevenueJourneyCanonicalOwner,
  REVENUE_JOURNEY_COMPANY_BOUNDARY,
} from './canonical-reconciliation.js';

export const REVENUE_LEAD_OPPORTUNITY_EVIDENCE_SCHEMA = 'titan.zero.revenue-journey.lead-opportunity-evidence/v1' as const;

const clean = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

export type RevenueLeadOpportunityEvidenceKind = 'lead' | 'opportunity';

export type RevenueLeadOpportunityOwnershipEvidence = Readonly<{
  owner_ref: string;
  ownership_source_ref: string;
  ownership_revision: string;
  captured_at: string;
}>;

export type RevenueLeadOpportunityLifecycleEvidence = Readonly<{
  schema: typeof REVENUE_LEAD_OPPORTUNITY_EVIDENCE_SCHEMA;
  company_id: string;
  revenue_journey_id: string;
  correlation_id: string | null;
  kind: RevenueLeadOpportunityEvidenceKind;
  lifecycle_event_id: string;
  idempotency_key: string;
  source: Readonly<{
    source_domain: string;
    source_ref: string;
    producer: string;
    source_event_id: string;
    observed_at: string;
  }>;
  ownership: Readonly<{
    canonical_owner: string;
    source_of_truth: true;
    projection_owns_truth: false;
    owner_ref: string;
    ownership_source_ref: string;
    ownership_revision: string;
    captured_at: string;
  }>;
  transition_evidence: Readonly<{
    lifecycle_schema: typeof REVENUE_LEAD_OPPORTUNITY_LIFECYCLE_SCHEMA;
    from_state: string;
    to_state: string;
    disposition: string;
    evidence_refs: readonly string[];
  }>;
  lifecycle_event: Readonly<Record<string, unknown>>;
  governance: Readonly<{
    company_boundary: typeof REVENUE_JOURNEY_COMPANY_BOUNDARY;
    identity_is_authority: false;
    ownership_evidence_grants_authority: false;
    authority_granted: false;
    execution_permitted: false;
    owns_domain_truth: false;
    may_create_entities: false;
    may_mutate_entities: false;
    derived_evidence_only: true;
  }>;
}>;

export function buildLeadOpportunityLifecycleEvidence(input: Readonly<Record<string, any>>): RevenueLeadOpportunityLifecycleEvidence {
  const companyId = assertRevenueJourneyCompanyBoundary(input as Readonly<Record<string, unknown>>);
  const kind = clean(input.kind) as RevenueLeadOpportunityEvidenceKind | null;
  if (kind !== 'lead' && kind !== 'opportunity') throw new TypeError('revenue-lead-opportunity-evidence-kind-invalid');

  const owner = getRevenueJourneyCanonicalOwner(kind);
  if (!owner) throw new TypeError(`revenue-lead-opportunity-evidence-owner-unresolved:${kind}`);

  const sourceDomain = clean(input.source_domain);
  const sourceRef = clean(input.source_ref);
  if (!sourceDomain || !sourceRef) throw new TypeError('revenue-lead-opportunity-evidence-source-required');
  if (sourceDomain !== owner.sourceDomain) throw new TypeError(`revenue-lead-opportunity-evidence-source-domain-mismatch:${kind}`);

  const ownershipInput = input.ownership_evidence ?? {};
  const ownerRef = clean(ownershipInput.owner_ref);
  const ownershipSourceRef = clean(ownershipInput.ownership_source_ref);
  const ownershipRevision = clean(ownershipInput.ownership_revision);
  const capturedAt = clean(ownershipInput.captured_at);
  if (!ownerRef || !ownershipSourceRef || !ownershipRevision || !capturedAt) {
    throw new TypeError('revenue-lead-opportunity-evidence-ownership-required');
  }

  const lifecycleEvent = buildLeadOpportunityLifecycleTransition(input);
  if (lifecycleEvent.company_id !== companyId) throw new TypeError('revenue-lead-opportunity-evidence-cross-company-lifecycle');
  if (lifecycleEvent.kind !== kind) throw new TypeError('revenue-lead-opportunity-evidence-kind-drift');

  const producer = clean(lifecycleEvent.provenance?.producer);
  const sourceEventId = clean(lifecycleEvent.provenance?.source_event_id);
  const observedAt = clean(lifecycleEvent.provenance?.observed_at);
  const evidenceRefs = Object.freeze((lifecycleEvent.provenance?.evidence_refs ?? []).map((value: unknown) => clean(value)).filter((value: string | null): value is string => Boolean(value)));
  if (!producer || !sourceEventId || !observedAt || !evidenceRefs.length) throw new TypeError('revenue-lead-opportunity-evidence-lifecycle-provenance-invalid');

  return Object.freeze({
    schema: REVENUE_LEAD_OPPORTUNITY_EVIDENCE_SCHEMA,
    company_id: companyId,
    revenue_journey_id: lifecycleEvent.revenue_journey_id,
    correlation_id: clean(lifecycleEvent.correlation?.correlation_id),
    kind,
    lifecycle_event_id: lifecycleEvent.lifecycle_event_id,
    idempotency_key: lifecycleEvent.idempotency_key,
    source: Object.freeze({
      source_domain: sourceDomain,
      source_ref: sourceRef,
      producer,
      source_event_id: sourceEventId,
      observed_at: observedAt,
    }),
    ownership: Object.freeze({
      canonical_owner: owner.canonicalOwner,
      source_of_truth: true,
      projection_owns_truth: false,
      owner_ref: ownerRef,
      ownership_source_ref: ownershipSourceRef,
      ownership_revision: ownershipRevision,
      captured_at: capturedAt,
    }),
    transition_evidence: Object.freeze({
      lifecycle_schema: REVENUE_LEAD_OPPORTUNITY_LIFECYCLE_SCHEMA,
      from_state: lifecycleEvent.transition.from_state,
      to_state: lifecycleEvent.transition.to_state,
      disposition: lifecycleEvent.transition.disposition,
      evidence_refs: evidenceRefs,
    }),
    lifecycle_event: lifecycleEvent,
    governance: Object.freeze({
      company_boundary: REVENUE_JOURNEY_COMPANY_BOUNDARY,
      identity_is_authority: false,
      ownership_evidence_grants_authority: false,
      authority_granted: false,
      execution_permitted: false,
      owns_domain_truth: false,
      may_create_entities: false,
      may_mutate_entities: false,
      derived_evidence_only: true,
    }),
  });
}

export function assertLeadOpportunityEvidenceReplay(
  existing: RevenueLeadOpportunityLifecycleEvidence,
  candidate: RevenueLeadOpportunityLifecycleEvidence,
): boolean {
  if (existing.company_id !== candidate.company_id) return false;
  if (existing.revenue_journey_id !== candidate.revenue_journey_id) return false;
  if (existing.idempotency_key !== candidate.idempotency_key) return false;
  return existing.source.source_event_id === candidate.source.source_event_id
    && existing.source.source_ref === candidate.source.source_ref
    && existing.ownership.ownership_revision === candidate.ownership.ownership_revision
    && existing.transition_evidence.from_state === candidate.transition_evidence.from_state
    && existing.transition_evidence.to_state === candidate.transition_evidence.to_state;
}
