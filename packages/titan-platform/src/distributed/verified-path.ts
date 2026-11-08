import type { CanonicalDistributedContext } from './context.js';
import { assertCanonicalDistributedContext } from './context.js';

/** Correlation contract for the canonical intent → execution → verification path. */
export interface AcceptedChangeCorrelation extends CanonicalDistributedContext {
  command_id: string;
  execution_id: string;
  provider_receipt_ref: string;
  observed_verification_ref: string;
  evidence_ref: string;
  idempotency_key: string;
  correlation_id: string;
  provider_status: 'SUCCEEDED';
  observed_verified: true;
}

export type VerifiedPathDecision =
  | { kind: 'ACCEPTED_CHANGE'; correlation: AcceptedChangeCorrelation }
  | { kind: 'REJECT'; reason: 'PROVIDER_NOT_SUCCEEDED' | 'OBSERVATION_NOT_VERIFIED' | 'CORRELATION_MISMATCH' };

export function correlateVerifiedChange(input: {
  context: CanonicalDistributedContext;
  command_id: string;
  execution_id: string;
  provider_receipt_ref: string;
  provider_status: 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
  observed_verification_ref: string;
  observed_verified: boolean;
  evidence_ref: string;
  idempotency_key: string;
  correlation_id: string;
  observed_company_id: string;
}): VerifiedPathDecision {
  assertCanonicalDistributedContext(input.context);
  if (input.provider_status !== 'SUCCEEDED') return { kind: 'REJECT', reason: 'PROVIDER_NOT_SUCCEEDED' };
  if (!input.observed_verified) return { kind: 'REJECT', reason: 'OBSERVATION_NOT_VERIFIED' };
  if (input.observed_company_id !== input.context.company_id) return { kind: 'REJECT', reason: 'CORRELATION_MISMATCH' };
  const required = [input.command_id, input.execution_id, input.provider_receipt_ref, input.observed_verification_ref, input.evidence_ref, input.idempotency_key, input.correlation_id];
  if (required.some(value => !value.trim())) return { kind: 'REJECT', reason: 'CORRELATION_MISMATCH' };
  return { kind: 'ACCEPTED_CHANGE', correlation: { ...input.context, command_id: input.command_id, execution_id: input.execution_id, provider_receipt_ref: input.provider_receipt_ref, observed_verification_ref: input.observed_verification_ref, evidence_ref: input.evidence_ref, idempotency_key: input.idempotency_key, correlation_id: input.correlation_id, provider_status: 'SUCCEEDED', observed_verified: true } };
}

