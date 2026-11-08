import type { TitanDelegationLifecycleState, TitanDelegationTaskEnvelope } from './index.js';
import { normalizeTitanDelegationTaskEnvelope } from './index.js';

export const TITAN_DELEGATION_TELEMETRY_EVENT_TYPES = Object.freeze([
  'STATE_TRANSITION',
  'ROUTE_EVALUATED',
  'LEASE_CLAIMED',
  'LEASE_HEARTBEAT',
  'LEASE_RELEASED',
  'HANDOFF_CREATED',
  'ESCALATION_CREATED',
  'ESCALATION_RESOLVED',
  'RECOVERY_PLANNED',
] as const);
export type TitanDelegationTelemetryEventType = (typeof TITAN_DELEGATION_TELEMETRY_EVENT_TYPES)[number];

export type TitanDelegationTelemetryEvent = Readonly<{
  schema: 'titan.workforce.delegation-telemetry-event.v1';
  company_id: string;
  event_id: string;
  event_type: TitanDelegationTelemetryEventType;
  delegation_id: string;
  root_delegation_id: string;
  parent_delegation_id: string | null;
  correlation_id: string;
  causation_id: string | null;
  occurred_at: string;
  actor_id: string | null;
  state_before: TitanDelegationLifecycleState | null;
  state_after: TitanDelegationLifecycleState | null;
  summary: string;
  reason_codes: readonly string[];
  evidence_refs: readonly string[];
  authority_ceiling: TitanDelegationTaskEnvelope['authority_ceiling'];
  projection_only: true;
  grants_authority: false;
  authority_effect: false;
  execution_permitted: false;
}>;

function requiredText(value: unknown, code: string): string {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(code);
  return text;
}

function optionalText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function isoTimestamp(value: unknown): string {
  const text = requiredText(value, 'delegation-telemetry-occurred-at-required');
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error('delegation-telemetry-occurred-at-invalid');
  return new Date(ms).toISOString();
}

function normalizedList(values: readonly unknown[] | undefined): readonly string[] {
  return Object.freeze([...new Set((values ?? []).map((value) => String(value ?? '').trim()).filter(Boolean))].sort());
}

function assertNoPrivateReasoning(input: Record<string, unknown>): void {
  const forbidden = ['chain_of_thought', 'chainOfThought', 'private_reasoning', 'privateReasoning', 'prompt', 'raw_prompt'];
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(input, key)) throw new Error(`delegation-telemetry-private-field-forbidden:${key}`);
  }
}

export function createTitanDelegationTelemetryEvent(input: {
  envelope: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0];
  event_id?: string;
  event_type?: TitanDelegationTelemetryEventType;
  occurred_at?: string;
  actor_id?: string | null;
  causation_id?: string | null;
  state_before?: TitanDelegationLifecycleState | null;
  state_after?: TitanDelegationLifecycleState | null;
  summary?: string;
  reason_codes?: readonly string[];
  evidence_refs?: readonly string[];
  [key: string]: unknown;
}): TitanDelegationTelemetryEvent {
  assertNoPrivateReasoning(input);
  const envelope = normalizeTitanDelegationTaskEnvelope(input.envelope);
  const event_type = String(input.event_type ?? '') as TitanDelegationTelemetryEventType;
  if (!TITAN_DELEGATION_TELEMETRY_EVENT_TYPES.includes(event_type)) {
    throw new Error(`delegation-telemetry-event-type-invalid:${event_type}`);
  }
  return Object.freeze({
    schema: 'titan.workforce.delegation-telemetry-event.v1',
    company_id: envelope.company_id,
    event_id: requiredText(input.event_id, 'delegation-telemetry-event-id-required'),
    event_type,
    delegation_id: envelope.delegation_id,
    root_delegation_id: envelope.causality.root_delegation_id,
    parent_delegation_id: envelope.causality.parent_delegation_id,
    correlation_id: envelope.causality.correlation_id,
    causation_id: optionalText(input.causation_id ?? envelope.causality.source_event_id),
    occurred_at: isoTimestamp(input.occurred_at ?? new Date().toISOString()),
    actor_id: optionalText(input.actor_id),
    state_before: input.state_before ?? null,
    state_after: input.state_after ?? null,
    summary: requiredText(input.summary, 'delegation-telemetry-summary-required'),
    reason_codes: normalizedList(input.reason_codes),
    evidence_refs: normalizedList(input.evidence_refs),
    authority_ceiling: envelope.authority_ceiling,
    projection_only: true,
    grants_authority: false,
    authority_effect: false,
    execution_permitted: false,
  });
}

export function toTitanEventLedgerInput(event: TitanDelegationTelemetryEvent) {
  return Object.freeze({
    event_id: event.event_id,
    event_type: `workforce.delegation.${event.event_type.toLowerCase()}`,
    category: 'workflow',
    company_id: event.company_id,
    operation_id: event.delegation_id,
    correlation_id: event.correlation_id,
    causation_id: event.causation_id ?? undefined,
    actor_id: event.actor_id ?? undefined,
    occurred_at: event.occurred_at,
    source: 'titan.workforce.delegation',
    payload: Object.freeze({
      root_delegation_id: event.root_delegation_id,
      parent_delegation_id: event.parent_delegation_id,
      state_before: event.state_before,
      state_after: event.state_after,
      summary: event.summary,
      reason_codes: event.reason_codes,
      authority_ceiling: event.authority_ceiling,
      projection_only: true,
      grants_authority: false,
      authority_effect: false,
      execution_permitted: false,
    }),
    evidence_refs: event.evidence_refs,
  });
}

function assertBoundEvent(event: TitanDelegationTelemetryEvent, envelope: TitanDelegationTaskEnvelope): void {
  if (event.company_id !== envelope.company_id) throw new Error('delegation-telemetry-company-mismatch');
  if (event.root_delegation_id !== envelope.causality.root_delegation_id) throw new Error('delegation-telemetry-root-mismatch');
  if (event.correlation_id !== envelope.causality.correlation_id) throw new Error('delegation-telemetry-correlation-mismatch');
}

function ordered(events: readonly TitanDelegationTelemetryEvent[]): readonly TitanDelegationTelemetryEvent[] {
  return Object.freeze([...events].sort((a, b) => {
    const time = Date.parse(a.occurred_at) - Date.parse(b.occurred_at);
    return time !== 0 ? time : a.event_id.localeCompare(b.event_id);
  }));
}

export function buildTitanDelegationTaskHistory(input: {
  envelope: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0];
  events: readonly TitanDelegationTelemetryEvent[];
  include_descendants?: boolean;
}) {
  const envelope = normalizeTitanDelegationTaskEnvelope(input.envelope);
  const includeDescendants = input.include_descendants === true;
  const relevant = ordered((input.events ?? []).filter((event) => {
    assertBoundEvent(event, envelope);
    return includeDescendants ? event.root_delegation_id === envelope.causality.root_delegation_id : event.delegation_id === envelope.delegation_id;
  }));
  const currentState = [...relevant].reverse().find((event) => event.state_after)?.state_after ?? null;
  return Object.freeze({
    schema: 'titan.workforce.delegation-task-history.v1',
    company_id: envelope.company_id,
    delegation_id: envelope.delegation_id,
    root_delegation_id: envelope.causality.root_delegation_id,
    correlation_id: envelope.causality.correlation_id,
    include_descendants: includeDescendants,
    current_state: currentState,
    event_count: relevant.length,
    events: relevant,
    read_only: true as const,
    projection_only: true as const,
    authority_effect: false as const,
    grants_authority: false as const,
  });
}

export function explainTitanDelegationTrace(input: {
  envelope: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0];
  events: readonly TitanDelegationTelemetryEvent[];
}) {
  const envelope = normalizeTitanDelegationTaskEnvelope(input.envelope);
  const history = buildTitanDelegationTaskHistory({ envelope, events: input.events, include_descendants: true });
  const counts: Record<string, number> = {};
  const reasonCodes = new Set<string>();
  for (const event of history.events) {
    counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
    event.reason_codes.forEach((code) => reasonCodes.add(code));
  }
  const last = history.events.at(-1) ?? null;
  return Object.freeze({
    schema: 'titan.workforce.delegation-diagnostic-explanation.v1',
    company_id: envelope.company_id,
    delegation_id: envelope.delegation_id,
    root_delegation_id: envelope.causality.root_delegation_id,
    correlation_id: envelope.causality.correlation_id,
    current_state: history.current_state,
    last_event_id: last?.event_id ?? null,
    last_event_type: last?.event_type ?? null,
    last_event_at: last?.occurred_at ?? null,
    event_counts: Object.freeze({ ...counts }),
    reason_codes: Object.freeze([...reasonCodes].sort()),
    explanation: last
      ? `Latest coordination event: ${last.event_type}. ${last.summary}`
      : 'No delegation coordination events have been recorded for this trace.',
    private_reasoning_persisted: false as const,
    read_only: true as const,
    projection_only: true as const,
    authority_effect: false as const,
    grants_authority: false as const,
    execution_permitted: false as const,
  });
}
