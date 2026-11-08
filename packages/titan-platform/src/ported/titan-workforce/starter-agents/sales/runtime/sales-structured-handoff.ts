// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/sales/runtime/sales-structured-handoff.mjs
import { createHash } from 'node:crypto';

export const SALES_STRUCTURED_HANDOFF_SCHEMA = 'titan-zero-starter-sales-structured-handoff/v1';

const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const uniq = (values) => Object.freeze([...new Set(values.filter(Boolean))]);

function rejectLegacyBoundary(input) {
  if (!input || typeof input !== 'object') return;
  for (const key of ['tenant_id', 'tenant_company_id']) {
    if (key in input) throw new TypeError('legacy tenant boundaries are not accepted by Sales structured handoff');
  }
}

function assertCompany(companyId, object, label) {
  rejectLegacyBoundary(object);
  const nested = clean(object?.company_id);
  if (nested && nested !== companyId) throw new TypeError(`cross-company ${label} rejected`);
}

function stableKey(parts) {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function normalizeEvidence(items = []) {
  if (!Array.isArray(items)) throw new TypeError('evidence must be an array');
  return Object.freeze(items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new TypeError(`evidence ${index} must be an object`);
    rejectLegacyBoundary(item);
    const kind = clean(item.kind);
    const summary = clean(item.summary);
    const sourceRef = clean(item.source_ref);
    if (!kind || !summary || !sourceRef) throw new TypeError('evidence requires kind, summary, and source_ref');
    if ('chain_of_thought' in item || 'hidden_reasoning' in item) throw new TypeError('private chain-of-thought is not accepted as handoff evidence');
    return Object.freeze({ kind, summary, source_ref: sourceRef, confidence: item.confidence ?? null });
  }));
}

function normalizeDuplicateCheck(companyId, target, check = {}) {
  assertCompany(companyId, check, 'duplicate check');
  if (check.checked !== true) throw new TypeError(`authoritative duplicate check is required before ${target} handoff`);
  const sourceRef = clean(check.source_ref);
  if (!sourceRef) throw new TypeError('duplicate check requires source_ref');
  const existingId = clean(target === 'booking' ? check.existing_booking_id : check.existing_quote_id);
  return Object.freeze({ checked: true, source_ref: sourceRef, existing_downstream_id: existingId });
}

export function createSalesStructuredHandoff(input = {}) {
  rejectLegacyBoundary(input);
  const companyId = clean(input.company_id);
  const target = clean(input.target);
  const leadId = clean(input.lead_id);
  const correlationId = clean(input.correlation_id);
  if (!companyId) throw new TypeError('company_id is required');
  if (!['quote', 'booking'].includes(target)) throw new TypeError('target must be quote or booking');
  if (!leadId) throw new TypeError('lead_id is required');
  if (!correlationId) throw new TypeError('correlation_id is required');

  for (const [label, object] of Object.entries({
    customer_context: input.customer_context,
    service_context: input.service_context,
    interaction_context: input.interaction_context,
    duplicate_check: input.duplicate_check,
  })) assertCompany(companyId, object, label);

  const customerId = clean(input.customer_id ?? input.customer_context?.customer_id);
  const opportunityId = clean(input.opportunity_id);
  const journeyId = clean(input.journey_id ?? input.interaction_context?.journey_id);
  const quoteId = clean(input.quote_id);
  if (target === 'booking' && !quoteId && input.booking_without_quote !== true) {
    throw new TypeError('booking handoff requires quote_id unless booking_without_quote=true is explicitly supplied');
  }

  const duplicate = normalizeDuplicateCheck(companyId, target, input.duplicate_check);
  const evidence = normalizeEvidence(input.evidence ?? []);
  if (!evidence.length) throw new TypeError('at least one structured evidence item is required');
  const reasons = uniq((input.reasons ?? []).map(clean));
  if (!reasons.length) throw new TypeError('at least one handoff reason is required');

  const stableSubject = target === 'booking' ? (quoteId ?? leadId) : leadId;
  const idempotencyKey = clean(input.idempotency_key) ?? `sales:${target}:${stableKey([companyId, stableSubject, correlationId]).slice(0, 32)}`;
  const existingReceipt = input.existing_receipt ?? null;
  if (existingReceipt) assertCompany(companyId, existingReceipt, 'existing receipt');
  const receiptKey = clean(existingReceipt?.idempotency_key);
  const receiptState = clean(existingReceipt?.status);
  const receiptSuppresses = receiptKey === idempotencyKey && ['pending', 'accepted', 'completed', 'unknown'].includes(receiptState);
  const authoritativeDuplicate = Boolean(duplicate.existing_downstream_id);
  const suppressed = authoritativeDuplicate || receiptSuppresses;

  const workflow = target === 'quote'
    ? Object.freeze({ path: 'titan-business-services/workflows/create_quote.json', capability: 'crm.quote.create' })
    : Object.freeze({ path: 'titan-business-services/workflows/service_booking.json', capability: 'service.booking' });

  const packet = Object.freeze({
    target,
    workflow,
    company_id: companyId,
    lead_ref: Object.freeze({ lead_id: leadId, opportunity_id: opportunityId, customer_id: customerId, quote_id: quoteId }),
    interaction_ref: Object.freeze({ correlation_id: correlationId, journey_id: journeyId, conversation_id: clean(input.interaction_context?.conversation_id) }),
    context: Object.freeze({
      customer: Object.freeze({ ...(input.customer_context ?? {}), company_id: companyId }),
      service: Object.freeze({ ...(input.service_context ?? {}), company_id: companyId }),
    }),
    reasons,
    evidence,
    idempotency_key: idempotencyKey,
    delivery_semantics: Object.freeze({
      proposal_only: true,
      delivery_is_not_business_completion: true,
      retry_requires_authoritative_receipt_state: true,
      accepted_or_unknown_receipt_must_not_be_blindly_replayed: true,
    }),
  });

  return Object.freeze({
    schema: SALES_STRUCTURED_HANDOFF_SCHEMA,
    company_id: companyId,
    target,
    disposition: suppressed ? 'duplicate_suppressed' : 'handoff_proposed',
    handoff: suppressed ? null : packet,
    proposed_packet: packet,
    duplicate_guard: Object.freeze({
      authoritative_check: duplicate,
      receipt_suppressed: receiptSuppresses,
      downstream_duplicate_suppressed: authoritativeDuplicate,
    }),
    restrictions: Object.freeze({
      crm_mutation_performed: false,
      quote_creation_performed: false,
      booking_creation_performed: false,
      downstream_completion_inferred: false,
      persistence_performed: false,
    }),
    authority_neutral: true,
    execution_authority: false,
  });
}
