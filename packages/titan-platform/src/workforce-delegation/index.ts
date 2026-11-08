import { createWorkforceRetryEvaluator } from '../ported/titan-workforce/gateway/failure-retry.js';
export const TITAN_DELEGATION_LIFECYCLE_STATES = Object.freeze([
  'PROPOSED',
  'ROUTED',
  'CLAIMED',
  'IN_PROGRESS',
  'BLOCKED',
  'ESCALATED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const);

export type TitanDelegationLifecycleState = (typeof TITAN_DELEGATION_LIFECYCLE_STATES)[number];

export type TitanDelegationPrimitive = Readonly<{
  id: string;
  responsibility: string;
  existingModule: string;
  reuseRule: string;
}>;

export const TITAN_DELEGATION_PRIMITIVE_MAP: readonly TitanDelegationPrimitive[] = Object.freeze([
  {
    id: 'company_boundary',
    responsibility: 'Tenant isolation for every delegation and authority decision',
    existingModule: 'titan-runtime/authority/company-boundary',
    reuseRule: 'company_id is the sole canonical business boundary; delegation may never widen or substitute it',
  },
  {
    id: 'authority_delegation',
    responsibility: 'Bounded authority ancestry, expiry, depth and scope continuity',
    existingModule: 'titan-runtime/authority/delegation',
    reuseRule: 'reuse authority delegation continuity; workforce delegation identity never grants authority',
  },
  {
    id: 'authority_lease',
    responsibility: 'Time-bounded authority validity and revocation',
    existingModule: 'titan-runtime/authority/authority-lease + lease-control',
    reuseRule: 'delegated work must contract to an active authority lease rather than create its own permission model',
  },
  {
    id: 'operation_identity',
    responsibility: 'Idempotency, causality and restart-safe operation identity',
    existingModule: 'titan-runtime/operation-identity',
    reuseRule: 'delegation execution reuses operation identity; do not add a second idempotency ledger',
  },
  {
    id: 'workflow_execution',
    responsibility: 'Ordered tool/command/projection execution',
    existingModule: 'titan-modules/workflow-runtime',
    reuseRule: 'delegation routes work into the existing workflow runtime; it is not a replacement workflow engine',
  },
  {
    id: 'hierarchy_routing',
    responsibility: 'Manager/Supervisor/Specialist/Worker route construction',
    existingModule: 'titan-workforce/hierarchy/delegation-routing-runtime',
    reuseRule: 'reuse hierarchy route semantics and keep execution_permitted false until authority/capability gates pass',
  },
  {
    id: 'decision_rights',
    responsibility: 'Who may decide, propose, approve or execute',
    existingModule: 'titan-workforce/decision/decision-rights-runtime',
    reuseRule: 'delegation cannot exceed the originating decision-rights ceiling',
  },
  {
    id: 'failure_retry',
    responsibility: 'Failure classification and bounded retry',
    existingModule: 'titan-workforce/gateway/failure-retry',
    reuseRule: 'reuse bounded retry/reconciliation policy; uncertain side effects are not replayed blindly',
  },
  {
    id: 'scheduling_escalation',
    responsibility: 'Approval and escalation precedent for operational conflicts',
    existingModule: 'titan-workforce/scheduling/scheduling-approval-escalation-runtime',
    reuseRule: 'escalation remains explicit and approval-gated rather than silently raising autonomy',
  },
  {
    id: 'business_command_gateway',
    responsibility: 'Native Business Ops command allow-list and risk classification',
    existingModule: '@ai-fsm/titan-platform/business-ops',
    reuseRule: 'delegated work may request governed commands only through existing command/risk contracts',
  },
]);

export const TITAN_DELEGATION_TERMINAL_STATES: ReadonlySet<TitanDelegationLifecycleState> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

const TRANSITIONS = Object.freeze({
  PROPOSED: ['ROUTED', 'CANCELLED'] as const,
  ROUTED: ['CLAIMED', 'BLOCKED', 'ESCALATED', 'CANCELLED'] as const,
  CLAIMED: ['IN_PROGRESS', 'BLOCKED', 'ESCALATED', 'CANCELLED'] as const,
  IN_PROGRESS: ['BLOCKED', 'ESCALATED', 'COMPLETED', 'FAILED', 'CANCELLED'] as const,
  BLOCKED: ['ROUTED', 'CLAIMED', 'ESCALATED', 'FAILED', 'CANCELLED'] as const,
  ESCALATED: ['ROUTED', 'CLAIMED', 'IN_PROGRESS', 'FAILED', 'CANCELLED'] as const,
  COMPLETED: [] as const,
  FAILED: [] as const,
  CANCELLED: [] as const,
}) satisfies Readonly<Record<TitanDelegationLifecycleState, readonly TitanDelegationLifecycleState[]>>;

export type TitanDelegationLifecycleRecord = Readonly<{
  company_id: string;
  delegation_id: string;
  state: TitanDelegationLifecycleState;
  authority_effect: false;
  identity_confers_authority: false;
  queue_owner: 'existing_workflow_or_domain_runtime';
}>;

function required(value: unknown, code: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

export function normalizeTitanDelegationLifecycle(input: {
  company_id?: string;
  delegation_id?: string;
  state?: TitanDelegationLifecycleState;
}): TitanDelegationLifecycleRecord {
  const company_id = required(input?.company_id, 'delegation-company-id-required');
  const delegation_id = required(input?.delegation_id, 'delegation-id-required');
  const state = String(input?.state ?? 'PROPOSED') as TitanDelegationLifecycleState;
  if (!TITAN_DELEGATION_LIFECYCLE_STATES.includes(state)) throw new Error(`delegation-state-invalid:${state}`);
  return Object.freeze({
    company_id,
    delegation_id,
    state,
    authority_effect: false,
    identity_confers_authority: false,
    queue_owner: 'existing_workflow_or_domain_runtime',
  });
}

export function canTransitionTitanDelegation(
  from: TitanDelegationLifecycleState,
  to: TitanDelegationLifecycleState,
): boolean {
  if (!TITAN_DELEGATION_LIFECYCLE_STATES.includes(from) || !TITAN_DELEGATION_LIFECYCLE_STATES.includes(to)) return false;
  return (TRANSITIONS[from] as readonly TitanDelegationLifecycleState[]).includes(to);
}

export function transitionTitanDelegationLifecycle(
  currentInput: Parameters<typeof normalizeTitanDelegationLifecycle>[0],
  nextState: TitanDelegationLifecycleState,
  binding: { company_id?: string } = {},
): TitanDelegationLifecycleRecord {
  const current = normalizeTitanDelegationLifecycle(currentInput);
  if (binding.company_id && required(binding.company_id, 'delegation-binding-company-id-required') !== current.company_id) {
    throw new Error('delegation-company-mismatch');
  }
  if (!canTransitionTitanDelegation(current.state, nextState)) {
    throw new Error(`delegation-transition-invalid:${current.state}->${nextState}`);
  }
  return Object.freeze({ ...current, state: nextState });
}

export function getTitanDelegationPrimitiveMap(): readonly TitanDelegationPrimitive[] {
  return TITAN_DELEGATION_PRIMITIVE_MAP;
}

export function getTitanDelegationLifecycleContract() {
  return Object.freeze({
    schema: 'titan.workforce.delegation-lifecycle.v1',
    states: TITAN_DELEGATION_LIFECYCLE_STATES,
    terminal_states: Object.freeze([...TITAN_DELEGATION_TERMINAL_STATES]),
    transitions: TRANSITIONS,
    company_boundary: 'company_id' as const,
    authority_rule: 'delegation_never_increases_authority' as const,
    execution_rule: 'existing_authority_and_command_gateways_only' as const,
    queue_rule: 'reuse_existing_workflow_or_domain_runtime' as const,
    identity_confers_authority: false as const,
  });
}

export const TITAN_DELEGATION_AUTHORITY_CEILINGS = Object.freeze([
  'READ_ONLY',
  'PROPOSE',
  'WRITE_INTERNAL',
  'EXTERNAL_COMMUNICATION',
  'FINANCIAL',
  'DESTRUCTIVE',
] as const);
export type TitanDelegationAuthorityCeiling = (typeof TITAN_DELEGATION_AUTHORITY_CEILINGS)[number];

export const TITAN_DELEGATION_PRIORITIES = Object.freeze(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const);
export type TitanDelegationPriority = (typeof TITAN_DELEGATION_PRIORITIES)[number];

export type TitanDelegationTaskEnvelope = Readonly<{
  schema: 'titan.workforce.delegation-task-envelope.v1';
  company_id: string;
  delegation_id: string;
  objective: string;
  inputs: Readonly<Record<string, unknown>>;
  authority_ceiling: TitanDelegationAuthorityCeiling;
  priority: TitanDelegationPriority;
  due_at: string | null;
  idempotency_key: string;
  causality: Readonly<{
    correlation_id: string;
    root_delegation_id: string;
    parent_delegation_id: string | null;
    source_event_id: string | null;
  }>;
  expected_outcome: Readonly<{
    description: string;
    evidence_required: readonly string[];
  }>;
  authority_effect: false;
  grants_authority: false;
  execution_permitted: false;
}>;

function objectInput(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('delegation-inputs-object-required');
  return { ...(value as Record<string, unknown>) };
}

function optionalText(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeDueAt(value: unknown): string | null {
  const text = optionalText(value);
  if (!text) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error('delegation-due-at-invalid');
  return new Date(ms).toISOString();
}

export function normalizeTitanDelegationTaskEnvelope(input: {
  company_id?: string;
  delegation_id?: string;
  objective?: string;
  inputs?: unknown;
  authority_ceiling?: TitanDelegationAuthorityCeiling;
  priority?: TitanDelegationPriority;
  due_at?: string | null;
  idempotency_key?: string;
  causality?: {
    correlation_id?: string;
    root_delegation_id?: string;
    parent_delegation_id?: string | null;
    source_event_id?: string | null;
  };
  expected_outcome?: { description?: string; evidence_required?: readonly string[] };
}): TitanDelegationTaskEnvelope {
  const company_id = required(input?.company_id, 'delegation-company-id-required');
  const delegation_id = required(input?.delegation_id, 'delegation-id-required');
  const objective = required(input?.objective, 'delegation-objective-required');
  const idempotency_key = required(input?.idempotency_key, 'delegation-idempotency-key-required');
  const authority_ceiling = String(input?.authority_ceiling ?? 'PROPOSE') as TitanDelegationAuthorityCeiling;
  if (!TITAN_DELEGATION_AUTHORITY_CEILINGS.includes(authority_ceiling)) {
    throw new Error(`delegation-authority-ceiling-invalid:${authority_ceiling}`);
  }
  const priority = String(input?.priority ?? 'NORMAL') as TitanDelegationPriority;
  if (!TITAN_DELEGATION_PRIORITIES.includes(priority)) throw new Error(`delegation-priority-invalid:${priority}`);
  const correlation_id = required(input?.causality?.correlation_id, 'delegation-correlation-id-required');
  const root_delegation_id = optionalText(input?.causality?.root_delegation_id) ?? delegation_id;
  const parent_delegation_id = optionalText(input?.causality?.parent_delegation_id);
  if (parent_delegation_id === delegation_id) throw new Error('delegation-parent-self-reference');
  const description = required(input?.expected_outcome?.description, 'delegation-expected-outcome-required');
  const evidence_required = Object.freeze([
    ...new Set((input?.expected_outcome?.evidence_required ?? []).map((item) => String(item ?? '').trim()).filter(Boolean)),
  ]);
  return Object.freeze({
    schema: 'titan.workforce.delegation-task-envelope.v1',
    company_id,
    delegation_id,
    objective,
    inputs: Object.freeze(objectInput(input?.inputs)),
    authority_ceiling,
    priority,
    due_at: normalizeDueAt(input?.due_at),
    idempotency_key,
    causality: Object.freeze({
      correlation_id,
      root_delegation_id,
      parent_delegation_id,
      source_event_id: optionalText(input?.causality?.source_event_id),
    }),
    expected_outcome: Object.freeze({ description, evidence_required }),
    authority_effect: false,
    grants_authority: false,
    execution_permitted: false,
  });
}

export function assertTitanDelegationEnvelopeCompany(
  envelopeInput: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0],
  company_id: string,
): TitanDelegationTaskEnvelope {
  const envelope = normalizeTitanDelegationTaskEnvelope(envelopeInput);
  if (envelope.company_id !== required(company_id, 'delegation-binding-company-id-required')) {
    throw new Error('delegation-company-mismatch');
  }
  return envelope;
}

export function deriveTitanDelegationOperationIdentity(
  envelopeInput: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0],
) {
  const envelope = normalizeTitanDelegationTaskEnvelope(envelopeInput);
  return Object.freeze({
    company_id: envelope.company_id,
    operation_id: envelope.delegation_id,
    correlation_id: envelope.causality.correlation_id,
    idempotency_key: envelope.idempotency_key,
    authority_ceiling: envelope.authority_ceiling,
    grants_authority: false as const,
  });
}


export type TitanDelegationRouteCandidate = Readonly<{
  company_id: string;
  candidate_id: string;
  tier: 'AGENT' | 'WORKER';
  capabilities: readonly string[];
  scopes: readonly string[];
  authority_ceiling: TitanDelegationAuthorityCeiling;
  active_workload: number;
  max_workload: number;
  available?: boolean;
}>;

export type TitanDelegationRoutingRequest = Readonly<{
  envelope: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0];
  required_capabilities?: readonly string[];
  required_scopes?: readonly string[];
  required_authority?: TitanDelegationAuthorityCeiling;
}>;

const AUTHORITY_RANK: Readonly<Record<TitanDelegationAuthorityCeiling, number>> = Object.freeze({
  READ_ONLY: 0,
  PROPOSE: 1,
  WRITE_INTERNAL: 2,
  EXTERNAL_COMMUNICATION: 3,
  FINANCIAL: 4,
  DESTRUCTIVE: 5,
});

function normSet(values: readonly string[] = []): readonly string[] {
  return Object.freeze([...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean))].sort());
}

function hasAll(haystack: readonly string[], needles: readonly string[]): boolean {
  const set = new Set(haystack);
  return needles.every((item) => set.has(item));
}

export function routeTitanDelegationTask(
  request: TitanDelegationRoutingRequest,
  candidates: readonly TitanDelegationRouteCandidate[],
) {
  const envelope = normalizeTitanDelegationTaskEnvelope(request.envelope);
  const required_capabilities = normSet(request.required_capabilities);
  const required_scopes = normSet(request.required_scopes);
  const required_authority = request.required_authority ?? envelope.authority_ceiling;
  if (!TITAN_DELEGATION_AUTHORITY_CEILINGS.includes(required_authority)) {
    throw new Error(`delegation-required-authority-invalid:${required_authority}`);
  }
  if (AUTHORITY_RANK[required_authority] > AUTHORITY_RANK[envelope.authority_ceiling]) {
    throw new Error('delegation-required-authority-exceeds-envelope');
  }

  const scored = candidates.map((candidate) => {
    const same_company = candidate.company_id === envelope.company_id;
    const available = candidate.available !== false;
    const candidate_capabilities = normSet(candidate.capabilities);
    const candidate_scopes = normSet(candidate.scopes);
    const capability_match = hasAll(candidate_capabilities, required_capabilities);
    const scope_match = hasAll(candidate_scopes, required_scopes);
    const authority_match = TITAN_DELEGATION_AUTHORITY_CEILINGS.includes(candidate.authority_ceiling)
      && AUTHORITY_RANK[candidate.authority_ceiling] >= AUTHORITY_RANK[required_authority];
    const max = Number(candidate.max_workload);
    const active = Number(candidate.active_workload);
    const workload_valid = Number.isFinite(max) && max > 0 && Number.isFinite(active) && active >= 0;
    const workload_ratio = workload_valid ? active / max : Number.POSITIVE_INFINITY;
    const eligible = same_company && available && capability_match && scope_match && authority_match && workload_valid && workload_ratio < 1;
    return Object.freeze({
      candidate,
      eligible,
      reasons: Object.freeze([
        ...(same_company ? [] : ['company_mismatch']),
        ...(available ? [] : ['unavailable']),
        ...(capability_match ? [] : ['capability_mismatch']),
        ...(scope_match ? [] : ['scope_mismatch']),
        ...(authority_match ? [] : ['authority_insufficient']),
        ...(workload_valid && workload_ratio < 1 ? [] : ['capacity_unavailable']),
      ]),
      workload_ratio,
    });
  });

  const eligible = scored.filter((x) => x.eligible).sort((a, b) => {
    if (a.workload_ratio !== b.workload_ratio) return a.workload_ratio - b.workload_ratio;
    if (a.candidate.tier !== b.candidate.tier) return a.candidate.tier === 'WORKER' ? -1 : 1;
    return a.candidate.candidate_id.localeCompare(b.candidate.candidate_id);
  });
  const selected = eligible[0]?.candidate ?? null;

  return Object.freeze({
    schema: 'titan.workforce.delegation-route-selection.v1',
    company_id: envelope.company_id,
    delegation_id: envelope.delegation_id,
    required_capabilities,
    required_scopes,
    required_authority,
    authority_ceiling: envelope.authority_ceiling,
    selected_candidate_id: selected?.candidate_id ?? null,
    selected_tier: selected?.tier ?? null,
    selected_effective_authority: selected ? required_authority : null,
    status: selected ? 'ROUTE_SELECTED' as const : 'NO_ELIGIBLE_ROUTE' as const,
    grants_authority: false as const,
    execution_permitted: false as const,
    evaluated_candidates: Object.freeze(scored),
  });
}

export type TitanDelegationLeaseState = 'ACTIVE' | 'EXPIRED' | 'RELEASED';

export type TitanDelegationLease = Readonly<{
  schema: 'titan.workforce.delegation-lease.v1';
  company_id: string;
  delegation_id: string;
  idempotency_key: string;
  claimant_id: string;
  claimant_tier: 'AGENT' | 'WORKER';
  generation: number;
  lease_token: string;
  claimed_at: string;
  heartbeat_at: string;
  lease_until: string;
  released_at: string | null;
  state: TitanDelegationLeaseState;
  grants_authority: false;
  authority_effect: false;
  execution_permitted: false;
}>;

function timestamp(value: unknown, code: string): string {
  const text = required(value, code);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error(code);
  return new Date(ms).toISOString();
}

function leaseState(lease: TitanDelegationLease, nowMs: number): TitanDelegationLeaseState {
  if (lease.released_at) return 'RELEASED';
  return Date.parse(lease.lease_until) <= nowMs ? 'EXPIRED' : 'ACTIVE';
}

function leaseToken(delegation_id: string, claimant_id: string, generation: number, claimed_at: string): string {
  return `lease:${delegation_id}:${claimant_id}:${generation}:${claimed_at}`;
}

function ttlMs(value: unknown): number {
  const ttl = Number(value ?? 60_000);
  if (!Number.isFinite(ttl) || ttl < 5_000 || ttl > 86_400_000) throw new Error('delegation-lease-ttl-invalid');
  return Math.trunc(ttl);
}

export function inspectTitanDelegationLease(
  lease: TitanDelegationLease,
  now: string,
) {
  const nowIso = timestamp(now, 'delegation-lease-now-invalid');
  const state = leaseState(lease, Date.parse(nowIso));
  return Object.freeze({
    ...lease,
    state,
    recoverable: state === 'EXPIRED',
    heartbeat_permitted: state === 'ACTIVE',
    grants_authority: false as const,
    execution_permitted: false as const,
  });
}

export function claimTitanDelegationLease(input: {
  envelope: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0];
  claimant_id?: string;
  claimant_tier?: 'AGENT' | 'WORKER';
  now?: string;
  ttl_ms?: number;
  existing_lease?: TitanDelegationLease | null;
}): TitanDelegationLease {
  const envelope = normalizeTitanDelegationTaskEnvelope(input.envelope);
  const claimant_id = required(input.claimant_id, 'delegation-claimant-id-required');
  const claimant_tier = input.claimant_tier;
  if (claimant_tier !== 'AGENT' && claimant_tier !== 'WORKER') throw new Error('delegation-claimant-tier-invalid');
  const now = timestamp(input.now ?? new Date().toISOString(), 'delegation-lease-now-invalid');
  const nowMs = Date.parse(now);
  const ttl = ttlMs(input.ttl_ms);
  const existing = input.existing_lease ?? null;

  let generation = 1;
  if (existing) {
    if (existing.company_id !== envelope.company_id) throw new Error('delegation-company-mismatch');
    if (existing.delegation_id !== envelope.delegation_id) throw new Error('delegation-lease-delegation-mismatch');
    if (existing.idempotency_key !== envelope.idempotency_key) throw new Error('delegation-lease-idempotency-mismatch');
    const state = leaseState(existing, nowMs);
    if (state === 'ACTIVE') {
      if (existing.claimant_id !== claimant_id || existing.claimant_tier !== claimant_tier) {
        throw new Error('delegation-lease-held');
      }
      return Object.freeze({ ...existing, state: 'ACTIVE' });
    }
    generation = existing.generation + 1;
  }

  const until = new Date(nowMs + ttl).toISOString();
  return Object.freeze({
    schema: 'titan.workforce.delegation-lease.v1',
    company_id: envelope.company_id,
    delegation_id: envelope.delegation_id,
    idempotency_key: envelope.idempotency_key,
    claimant_id,
    claimant_tier,
    generation,
    lease_token: leaseToken(envelope.delegation_id, claimant_id, generation, now),
    claimed_at: now,
    heartbeat_at: now,
    lease_until: until,
    released_at: null,
    state: 'ACTIVE',
    grants_authority: false,
    authority_effect: false,
    execution_permitted: false,
  });
}

export function heartbeatTitanDelegationLease(input: {
  lease: TitanDelegationLease;
  claimant_id?: string;
  lease_token?: string;
  now?: string;
  ttl_ms?: number;
}): TitanDelegationLease {
  const claimant_id = required(input.claimant_id, 'delegation-claimant-id-required');
  const token = required(input.lease_token, 'delegation-lease-token-required');
  const now = timestamp(input.now ?? new Date().toISOString(), 'delegation-lease-now-invalid');
  const nowMs = Date.parse(now);
  const state = leaseState(input.lease, nowMs);
  if (state !== 'ACTIVE') throw new Error(`delegation-lease-not-active:${state}`);
  if (input.lease.claimant_id !== claimant_id) throw new Error('delegation-lease-claimant-mismatch');
  if (input.lease.lease_token !== token) throw new Error('delegation-lease-token-mismatch');
  const until = new Date(nowMs + ttlMs(input.ttl_ms)).toISOString();
  return Object.freeze({ ...input.lease, heartbeat_at: now, lease_until: until, state: 'ACTIVE' as const });
}

export function releaseTitanDelegationLease(input: {
  lease: TitanDelegationLease;
  claimant_id?: string;
  lease_token?: string;
  now?: string;
}): TitanDelegationLease {
  const claimant_id = required(input.claimant_id, 'delegation-claimant-id-required');
  const token = required(input.lease_token, 'delegation-lease-token-required');
  const now = timestamp(input.now ?? new Date().toISOString(), 'delegation-lease-now-invalid');
  if (input.lease.claimant_id !== claimant_id) throw new Error('delegation-lease-claimant-mismatch');
  if (input.lease.lease_token !== token) throw new Error('delegation-lease-token-mismatch');
  if (input.lease.released_at) return input.lease;
  return Object.freeze({ ...input.lease, released_at: now, state: 'RELEASED' as const });
}

export function recoverTitanDelegationLease(input: {
  envelope: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0];
  expired_lease: TitanDelegationLease;
  claimant_id?: string;
  claimant_tier?: 'AGENT' | 'WORKER';
  now?: string;
  ttl_ms?: number;
}): TitanDelegationLease {
  const now = timestamp(input.now ?? new Date().toISOString(), 'delegation-lease-now-invalid');
  const inspected = inspectTitanDelegationLease(input.expired_lease, now);
  if (inspected.state !== 'EXPIRED' && inspected.state !== 'RELEASED') {
    throw new Error('delegation-lease-not-recoverable');
  }
  return claimTitanDelegationLease({
    envelope: input.envelope,
    claimant_id: input.claimant_id,
    claimant_tier: input.claimant_tier,
    now,
    ttl_ms: input.ttl_ms,
    existing_lease: input.expired_lease,
  });
}

export type TitanDelegationHandoff = Readonly<{
  schema: 'titan.workforce.delegation-handoff.v1';
  company_id: string;
  from_delegation_id: string;
  to_delegation_id: string;
  from_candidate_id: string;
  to_candidate_id: string;
  to_tier: 'AGENT' | 'WORKER';
  authority_ceiling: TitanDelegationAuthorityCeiling;
  correlation_id: string;
  root_delegation_id: string;
  parent_delegation_id: string;
  idempotency_key: string;
  objective: string;
  expected_outcome: TitanDelegationTaskEnvelope['expected_outcome'];
  grants_authority: false;
  authority_effect: false;
  execution_permitted: false;
}>;

export function createTitanDelegationHandoff(input: {
  parent_envelope: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0];
  from_candidate_id?: string;
  to_candidate_id?: string;
  to_tier?: 'AGENT' | 'WORKER';
  child_delegation_id?: string;
  child_objective?: string;
  child_idempotency_key?: string;
  requested_authority?: TitanDelegationAuthorityCeiling;
  expected_outcome?: { description?: string; evidence_required?: readonly string[] };
}): Readonly<{ handoff: TitanDelegationHandoff; child_envelope: TitanDelegationTaskEnvelope }> {
  const parent = normalizeTitanDelegationTaskEnvelope(input.parent_envelope);
  const from_candidate_id = required(input.from_candidate_id, 'delegation-handoff-from-candidate-required');
  const to_candidate_id = required(input.to_candidate_id, 'delegation-handoff-to-candidate-required');
  if (from_candidate_id === to_candidate_id) throw new Error('delegation-handoff-self-target');
  const to_tier = input.to_tier;
  if (to_tier !== 'AGENT' && to_tier !== 'WORKER') throw new Error('delegation-handoff-tier-invalid');
  const child_delegation_id = required(input.child_delegation_id, 'delegation-handoff-child-id-required');
  if (child_delegation_id === parent.delegation_id) throw new Error('delegation-handoff-child-must-differ');
  const requested_authority = input.requested_authority ?? parent.authority_ceiling;
  if (!TITAN_DELEGATION_AUTHORITY_CEILINGS.includes(requested_authority)) {
    throw new Error(`delegation-handoff-authority-invalid:${requested_authority}`);
  }
  if (AUTHORITY_RANK[requested_authority] > AUTHORITY_RANK[parent.authority_ceiling]) {
    throw new Error('delegation-handoff-authority-exceeds-parent');
  }

  const child = normalizeTitanDelegationTaskEnvelope({
    company_id: parent.company_id,
    delegation_id: child_delegation_id,
    objective: required(input.child_objective, 'delegation-handoff-objective-required'),
    inputs: parent.inputs,
    authority_ceiling: requested_authority,
    priority: parent.priority,
    due_at: parent.due_at,
    idempotency_key: required(input.child_idempotency_key, 'delegation-handoff-idempotency-required'),
    causality: {
      correlation_id: parent.causality.correlation_id,
      root_delegation_id: parent.causality.root_delegation_id,
      parent_delegation_id: parent.delegation_id,
      source_event_id: parent.causality.source_event_id,
    },
    expected_outcome: input.expected_outcome ?? parent.expected_outcome,
  });

  return Object.freeze({
    handoff: Object.freeze({
      schema: 'titan.workforce.delegation-handoff.v1',
      company_id: parent.company_id,
      from_delegation_id: parent.delegation_id,
      to_delegation_id: child.delegation_id,
      from_candidate_id,
      to_candidate_id,
      to_tier,
      authority_ceiling: child.authority_ceiling,
      correlation_id: child.causality.correlation_id,
      root_delegation_id: child.causality.root_delegation_id,
      parent_delegation_id: parent.delegation_id,
      idempotency_key: child.idempotency_key,
      objective: child.objective,
      expected_outcome: child.expected_outcome,
      grants_authority: false,
      authority_effect: false,
      execution_permitted: false,
    }),
    child_envelope: child,
  });
}

export function assertTitanDelegationHandoffChain(
  parentInput: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0],
  childInput: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0],
): true {
  const parent = normalizeTitanDelegationTaskEnvelope(parentInput);
  const child = normalizeTitanDelegationTaskEnvelope(childInput);
  if (child.company_id !== parent.company_id) throw new Error('delegation-handoff-company-mismatch');
  if (child.causality.parent_delegation_id !== parent.delegation_id) throw new Error('delegation-handoff-parent-mismatch');
  if (child.causality.root_delegation_id !== parent.causality.root_delegation_id) throw new Error('delegation-handoff-root-mismatch');
  if (child.causality.correlation_id !== parent.causality.correlation_id) throw new Error('delegation-handoff-correlation-mismatch');
  if (AUTHORITY_RANK[child.authority_ceiling] > AUTHORITY_RANK[parent.authority_ceiling]) {
    throw new Error('delegation-handoff-authority-exceeds-parent');
  }
  return true;
}


export const TITAN_DELEGATION_ESCALATION_REASONS = Object.freeze([
  'BLOCKED', 'AMBIGUOUS', 'RISKY', 'FAILED', 'TIME_SENSITIVE',
] as const);
export type TitanDelegationEscalationReason = (typeof TITAN_DELEGATION_ESCALATION_REASONS)[number];
export type TitanDelegationApprovalRequirement = 'MANAGER' | 'HUMAN' | 'MANAGER_AND_HUMAN';

export type TitanDelegationEscalation = Readonly<{
  schema: 'titan.workforce.delegation-escalation.v1';
  company_id: string;
  delegation_id: string;
  escalation_id: string;
  reason: TitanDelegationEscalationReason;
  summary: string;
  requested_resolution: string;
  idempotency_key: string;
  correlation_id: string;
  root_delegation_id: string;
  authority_ceiling: TitanDelegationAuthorityCeiling;
  deadline_at: string | null;
  approval_required: TitanDelegationApprovalRequirement;
  manager_approval_required: boolean;
  human_approval_required: boolean;
  grants_authority: false;
  authority_effect: false;
  execution_permitted: false;
}>;

export function createTitanDelegationEscalation(input: {
  envelope: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0];
  escalation_id?: string;
  reason?: TitanDelegationEscalationReason;
  summary?: string;
  requested_resolution?: string;
  idempotency_key?: string;
  deadline_at?: string | null;
}): TitanDelegationEscalation {
  const envelope = normalizeTitanDelegationTaskEnvelope(input.envelope);
  const reason = String(input.reason ?? '') as TitanDelegationEscalationReason;
  if (!TITAN_DELEGATION_ESCALATION_REASONS.includes(reason)) throw new Error(`delegation-escalation-reason-invalid:${reason}`);
  const approval_required: TitanDelegationApprovalRequirement = reason === 'RISKY'
    ? 'MANAGER_AND_HUMAN'
    : reason === 'AMBIGUOUS' || reason === 'TIME_SENSITIVE' ? 'HUMAN' : 'MANAGER';
  const deadline_at = normalizeDueAt(input.deadline_at ?? envelope.due_at);
  if (reason === 'TIME_SENSITIVE' && !deadline_at) throw new Error('delegation-escalation-deadline-required');
  return Object.freeze({
    schema: 'titan.workforce.delegation-escalation.v1',
    company_id: envelope.company_id,
    delegation_id: envelope.delegation_id,
    escalation_id: required(input.escalation_id, 'delegation-escalation-id-required'),
    reason,
    summary: required(input.summary, 'delegation-escalation-summary-required'),
    requested_resolution: required(input.requested_resolution, 'delegation-escalation-resolution-required'),
    idempotency_key: required(input.idempotency_key, 'delegation-escalation-idempotency-required'),
    correlation_id: envelope.causality.correlation_id,
    root_delegation_id: envelope.causality.root_delegation_id,
    authority_ceiling: envelope.authority_ceiling,
    deadline_at,
    approval_required,
    manager_approval_required: approval_required === 'MANAGER' || approval_required === 'MANAGER_AND_HUMAN',
    human_approval_required: approval_required === 'HUMAN' || approval_required === 'MANAGER_AND_HUMAN',
    grants_authority: false,
    authority_effect: false,
    execution_permitted: false,
  });
}

export function assertTitanDelegationEscalationBinding(
  envelopeInput: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0],
  escalation: TitanDelegationEscalation,
): true {
  const envelope = normalizeTitanDelegationTaskEnvelope(envelopeInput);
  if (escalation.company_id !== envelope.company_id) throw new Error('delegation-escalation-company-mismatch');
  if (escalation.delegation_id !== envelope.delegation_id) throw new Error('delegation-escalation-delegation-mismatch');
  if (escalation.correlation_id !== envelope.causality.correlation_id) throw new Error('delegation-escalation-correlation-mismatch');
  if (escalation.root_delegation_id !== envelope.causality.root_delegation_id) throw new Error('delegation-escalation-root-mismatch');
  if (AUTHORITY_RANK[escalation.authority_ceiling] > AUTHORITY_RANK[envelope.authority_ceiling]) throw new Error('delegation-escalation-authority-exceeds-envelope');
  return true;
}

export function resolveTitanDelegationEscalationApproval(input: {
  escalation: TitanDelegationEscalation;
  manager_approved?: boolean;
  human_approved?: boolean;
}) {
  const manager_ok = !input.escalation.manager_approval_required || input.manager_approved === true;
  const human_ok = !input.escalation.human_approval_required || input.human_approved === true;
  return Object.freeze({
    schema: 'titan.workforce.delegation-escalation-approval.v1',
    company_id: input.escalation.company_id,
    escalation_id: input.escalation.escalation_id,
    approved: manager_ok && human_ok,
    manager_approved: input.manager_approved === true,
    human_approved: input.human_approved === true,
    grants_authority: false as const,
    authority_effect: false as const,
    execution_permitted: false as const,
  });
}

export const TITAN_DELEGATION_RECOVERY_ACTIONS = Object.freeze([
  'NO_ACTION',
  'RETRY',
  'RESUME_REQUIRED',
  'COMPENSATE',
  'RECONCILE',
  'CANCEL',
] as const);
export type TitanDelegationRecoveryAction = (typeof TITAN_DELEGATION_RECOVERY_ACTIONS)[number];

export type TitanDelegationWorkflowStepResult = Readonly<{
  step_id: string;
  operation_kind: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNCERTAIN';
  dispatch_proven: boolean | null;
  retry_count: number;
  idempotency_key: string;
  compensatable: boolean;
  compensation_command: string | null;
}>;

export type TitanDelegationRecoveryPlan = Readonly<{
  schema: 'titan.workforce.delegation-recovery-plan.v1';
  company_id: string;
  delegation_id: string;
  correlation_id: string;
  failed_step_id: string | null;
  failure_class: string | null;
  action: TitanDelegationRecoveryAction;
  retry_allowed: boolean;
  retry_after_ms: number | null;
  requires_explicit_resume: boolean;
  compensation_steps: readonly Readonly<{
    step_id: string;
    compensation_command: string;
    idempotency_key: string;
  }>[];
  partial_failure: boolean;
  uncertain_effect: boolean;
  approval_required: boolean;
  execution_permitted: false;
  grants_authority: false;
  authority_effect: false;
}>;

function normalizeWorkflowStepResult(input: Partial<TitanDelegationWorkflowStepResult>): TitanDelegationWorkflowStepResult {
  const status = String(input.status ?? 'PENDING') as TitanDelegationWorkflowStepResult['status'];
  if (!['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNCERTAIN'].includes(status)) {
    throw new Error(`delegation-step-status-invalid:${status}`);
  }
  const retry_count = Number(input.retry_count ?? 0);
  if (!Number.isInteger(retry_count) || retry_count < 0) throw new Error('delegation-step-retry-count-invalid');
  return Object.freeze({
    step_id: required(input.step_id, 'delegation-step-id-required'),
    operation_kind: required(input.operation_kind, 'delegation-step-operation-kind-required').toLowerCase(),
    status,
    dispatch_proven: input.dispatch_proven === true ? true : input.dispatch_proven === false ? false : null,
    retry_count,
    idempotency_key: required(input.idempotency_key, 'delegation-step-idempotency-required'),
    compensatable: input.compensatable === true,
    compensation_command: optionalText(input.compensation_command),
  });
}

/**
 * Plans recovery only. It deliberately does not execute retries, compensation or cancellation.
 * Existing workforce failure classification/retry policy remains authoritative for replay safety;
 * effectful/uncertain operations require explicit resume or reconciliation.
 */
export async function planTitanDelegationRecovery(input: {
  envelope: Parameters<typeof normalizeTitanDelegationTaskEnvelope>[0];
  steps: readonly Partial<TitanDelegationWorkflowStepResult>[];
  failed_step_id?: string | null;
  failure?: Readonly<Record<string, unknown>> | null;
  cancel_requested?: boolean;
  retry_policy?: {
    evaluate(raw?: Record<string, unknown>, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
  };
}): Promise<TitanDelegationRecoveryPlan> {
  const envelope = normalizeTitanDelegationTaskEnvelope(input.envelope);
  const steps = Object.freeze((input.steps ?? []).map(normalizeWorkflowStepResult));
  const ids = new Set<string>();
  for (const step of steps) {
    if (ids.has(step.step_id)) throw new Error(`delegation-step-duplicate:${step.step_id}`);
    ids.add(step.step_id);
  }
  const failed_step_id = optionalText(input.failed_step_id);
  const failed = failed_step_id ? steps.find((step) => step.step_id === failed_step_id) ?? null : null;
  if (failed_step_id && !failed) throw new Error('delegation-failed-step-not-found');

  const succeeded = steps.filter((step) => step.status === 'SUCCEEDED');
  const partial_failure = succeeded.length > 0 && steps.some((step) => ['FAILED', 'UNCERTAIN'].includes(step.status));
  const uncertain_effect = steps.some((step) => step.status === 'UNCERTAIN' || (step.status === 'FAILED' && step.dispatch_proven !== false));
  const cancel_requested = input.cancel_requested === true;

  let failure_class: string | null = null;
  let retry_allowed = false;
  let retry_after_ms: number | null = null;
  let requires_explicit_resume = false;
  if (failed && input.failure) {
    const evaluator = input.retry_policy ?? createWorkforceRetryEvaluator();
    const evaluated = evaluator.evaluate({
      ...input.failure,
      company_id: envelope.company_id,
      operation_kind: failed.operation_kind,
      dispatch_proven: failed.dispatch_proven,
      retry_count: failed.retry_count,
      idempotency_key: failed.idempotency_key,
      operation_id: envelope.delegation_id,
    }, { company_id: envelope.company_id });
    failure_class = optionalText(evaluated.failure_class);
    retry_allowed = evaluated.retry_allowed === true;
    retry_after_ms = Number.isFinite(Number(evaluated.retry_after_ms)) ? Number(evaluated.retry_after_ms) : null;
    requires_explicit_resume = evaluated.requires_explicit_resume === true;
  }

  const compensation_steps = Object.freeze(succeeded
    .filter((step) => step.compensatable && step.compensation_command)
    .reverse()
    .map((step) => Object.freeze({
      step_id: step.step_id,
      compensation_command: step.compensation_command!,
      idempotency_key: `compensate:${step.idempotency_key}`,
    })));

  let action: TitanDelegationRecoveryAction = 'NO_ACTION';
  if (cancel_requested) {
    action = succeeded.length === 0 && !uncertain_effect ? 'CANCEL' : compensation_steps.length > 0 ? 'COMPENSATE' : 'RECONCILE';
  } else if (uncertain_effect) {
    action = 'RECONCILE';
  } else if (retry_allowed) {
    action = 'RETRY';
  } else if (partial_failure && compensation_steps.length > 0) {
    action = 'COMPENSATE';
  } else if (requires_explicit_resume) {
    action = 'RESUME_REQUIRED';
  } else if (failed) {
    action = 'RECONCILE';
  }

  const approval_required = action === 'COMPENSATE' || action === 'RECONCILE' || action === 'RESUME_REQUIRED';
  return Object.freeze({
    schema: 'titan.workforce.delegation-recovery-plan.v1',
    company_id: envelope.company_id,
    delegation_id: envelope.delegation_id,
    correlation_id: envelope.causality.correlation_id,
    failed_step_id,
    failure_class,
    action,
    retry_allowed,
    retry_after_ms,
    requires_explicit_resume,
    compensation_steps,
    partial_failure,
    uncertain_effect,
    approval_required,
    execution_permitted: false,
    grants_authority: false,
    authority_effect: false,
  });
}

export * from "./telemetry.js";

export * from "./simulation.js";

export * from "./certification.js";
