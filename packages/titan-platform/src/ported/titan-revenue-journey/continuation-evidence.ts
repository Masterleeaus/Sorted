import { REVENUE_CONTINUATION_LIFECYCLE_SCHEMA, buildRevenueContinuationLifecycle } from './revenue-continuation-lifecycle.js';

export const REVENUE_CONTINUATION_EVIDENCE_SCHEMA = 'titan.zero.revenue-journey.continuation-evidence.v1' as const;
export type RevenueContinuationOpportunity = 'REBOOKING'|'RECURRING_SERVICE'|'REVIEW'|'RETENTION';
const LEGACY=['tenant_id','tenantId','tenant_company_id','business_id','account_id'] as const;
const clean=(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():null;

export function buildRevenueContinuationEvidence(input: Record<string, any> = {}) {
  for(const key of LEGACY) if(input[key] != null) throw new TypeError(`revenue-continuation-evidence-legacy-company-boundary-forbidden:${key}`);
  const company_id=clean(input.company_id); if(!company_id) throw new TypeError('revenue-continuation-evidence-company-id-required');
  const opportunity=clean(input.opportunity) as RevenueContinuationOpportunity|null;
  if(!opportunity || !['REBOOKING','RECURRING_SERVICE','REVIEW','RETENTION'].includes(opportunity)) throw new TypeError('revenue-continuation-evidence-opportunity-invalid');
  const lifecycle=input.lifecycle ?? buildRevenueContinuationLifecycle(input.lifecycle_input ?? {});
  if(!lifecycle || lifecycle.schema!==REVENUE_CONTINUATION_LIFECYCLE_SCHEMA) throw new TypeError('revenue-continuation-evidence-valid-lifecycle-required');
  if(lifecycle.company_id!==company_id) throw new TypeError('revenue-continuation-evidence-cross-company-lifecycle');
  const customer_id=clean(input.customer_id ?? lifecycle.customer_id); if(!customer_id) throw new TypeError('revenue-continuation-evidence-customer-id-required');
  const customer_ref=clean(input.customer_ref); if(!customer_ref) throw new TypeError('revenue-continuation-evidence-customer-ref-required');
  const existing_journey_id=clean(input.existing_journey_id);
  if(existing_journey_id && existing_journey_id!==lifecycle.parent_revenue_journey_id && existing_journey_id!==lifecycle.candidate_revenue_journey_id) throw new TypeError('revenue-continuation-evidence-existing-journey-conflict');
  const review_ref=clean(input.review_ref), retention_ref=clean(input.retention_ref), recurring_ref=clean(input.recurring_ref);
  if(opportunity==='REVIEW' && !review_ref) throw new TypeError('revenue-continuation-evidence-review-ref-required');
  if(opportunity==='RETENTION' && !retention_ref) throw new TypeError('revenue-continuation-evidence-retention-ref-required');
  if(opportunity==='RECURRING_SERVICE' && !recurring_ref) throw new TypeError('revenue-continuation-evidence-recurring-ref-required');
  const may_propose_candidate = opportunity==='REBOOKING' && lifecycle.event_type==='customer_yes';
  const candidate_suppressed = Boolean(existing_journey_id) || !may_propose_candidate;
  return Object.freeze({
    schema:REVENUE_CONTINUATION_EVIDENCE_SCHEMA, company_id, customer_id, customer_ref, opportunity,
    parent_revenue_journey_id:lifecycle.parent_revenue_journey_id,
    candidate_revenue_journey_id:candidate_suppressed?null:lifecycle.candidate_revenue_journey_id,
    lifecycle_id:lifecycle.continuation_id,
    refs:Object.freeze({review_ref,retention_ref,recurring_ref}),
    duplicate_control:Object.freeze({existing_journey_id,authoritative_duplicate_check_required:true,candidate_suppressed,duplicate_customer_journey_creation_permitted:false}),
    handoff:lifecycle.handoff,
    semantics:Object.freeze({continuation_is_projection_only:true,review_does_not_create_journey:true,retention_signal_does_not_create_journey:true,recurrence_change_does_not_create_journey:true,rebooking_intent_may_only_propose_candidate:true,customer_journey_truth_remains_canonical:true}),
    governance:Object.freeze({company_boundary:'company_id',owns_domain_truth:false,identity_is_authority:false,authority_granted:false,execution_permitted:false,may_create_customer_journey:false,may_create_booking:false,may_create_schedule:false,may_send_review_request:false,may_send_retention_outreach:false,may_mutate_entities:false})
  });
}
