import {
  claimTitanDelegationLease,
  createTitanDelegationHandoff,
  heartbeatTitanDelegationLease,
  planTitanDelegationRecovery,
  recoverTitanDelegationLease,
  type TitanDelegationAuthorityCeiling,
  type TitanDelegationLease,
} from './index.js';

export const TITAN_DELEGATION_SIMULATION_SCENARIOS = Object.freeze([
  'LEASE_RACE',
  'STALE_LEASE_RECOVERY',
  'DUPLICATE_REQUEST',
  'PARTIAL_FAILURE',
  'AUTHORITY_CONTRACTION',
] as const);
export type TitanDelegationSimulationScenario = (typeof TITAN_DELEGATION_SIMULATION_SCENARIOS)[number];

export type TitanDelegationSimulationEnvelope = Readonly<{
  company_id: string;
  delegation_id: string;
  objective: string;
  inputs: Readonly<Record<string, unknown>>;
  authority_ceiling: TitanDelegationAuthorityCeiling;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  idempotency_key: string;
  causality: Readonly<{ correlation_id: string; root_delegation_id: string }>;
  expected_outcome: Readonly<{ description: string; evidence_required?: readonly string[] }>;
}>;

const DEFAULT_ENVELOPE: TitanDelegationSimulationEnvelope = Object.freeze({
  company_id: 'simulation-company',
  delegation_id: 'simulation-root',
  objective: 'deterministically verify delegation safety',
  inputs: Object.freeze({}),
  authority_ceiling: 'WRITE_INTERNAL',
  priority: 'HIGH',
  idempotency_key: 'simulation-idempotency',
  causality: Object.freeze({ correlation_id: 'simulation-correlation', root_delegation_id: 'simulation-root' }),
  expected_outcome: Object.freeze({ description: 'safety invariant verified' }),
});

function errorCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function baseResult(scenario: TitanDelegationSimulationScenario, envelope: TitanDelegationSimulationEnvelope) {
  return {
    schema: 'titan.workforce.delegation-simulation-result.v1' as const,
    scenario,
    company_id: envelope.company_id,
    delegation_id: envelope.delegation_id,
    correlation_id: envelope.causality.correlation_id,
    deterministic: true as const,
    side_effect_free: true as const,
    grants_authority: false as const,
    authority_effect: false as const,
    execution_permitted: false as const,
  };
}

export async function runTitanDelegationSimulation(input: {
  scenario: TitanDelegationSimulationScenario;
  envelope?: TitanDelegationSimulationEnvelope;
}) {
  const envelope = input.envelope ?? DEFAULT_ENVELOPE;
  const scenario = input.scenario;
  if (!TITAN_DELEGATION_SIMULATION_SCENARIOS.includes(scenario)) {
    throw new Error(`delegation-simulation-scenario-invalid:${scenario}`);
  }

  if (scenario === 'LEASE_RACE') {
    const first = claimTitanDelegationLease({ envelope, claimant_id: 'worker-a', claimant_tier: 'WORKER', now: '2026-09-13T00:00:00.000Z', ttl_ms: 5_000 });
    const contenderError = errorCode(() => claimTitanDelegationLease({
      envelope,
      claimant_id: 'worker-b',
      claimant_tier: 'WORKER',
      now: '2026-09-13T00:00:00.001Z',
      ttl_ms: 5_000,
      existing_lease: first,
    }));
    return Object.freeze({ ...baseResult(scenario, envelope), winner: first.claimant_id, generation: first.generation, contender_error: contenderError, invariant_passed: contenderError === 'delegation-lease-held' });
  }

  if (scenario === 'STALE_LEASE_RECOVERY') {
    const oldLease = claimTitanDelegationLease({ envelope, claimant_id: 'worker-a', claimant_tier: 'WORKER', now: '2026-09-13T00:00:00.000Z', ttl_ms: 5_000 });
    const recovered = recoverTitanDelegationLease({ envelope, expired_lease: oldLease, claimant_id: 'worker-b', claimant_tier: 'WORKER', now: '2026-09-13T00:00:06.000Z', ttl_ms: 5_000 });
    const staleError = errorCode(() => heartbeatTitanDelegationLease({ lease: oldLease, claimant_id: 'worker-a', lease_token: oldLease.lease_token, now: '2026-09-13T00:00:06.001Z', ttl_ms: 5_000 }));
    return Object.freeze({ ...baseResult(scenario, envelope), old_generation: oldLease.generation, recovered_generation: recovered.generation, recovered_claimant: recovered.claimant_id, stale_error: staleError, invariant_passed: recovered.generation === oldLease.generation + 1 && staleError === 'delegation-lease-not-active:EXPIRED' });
  }

  if (scenario === 'DUPLICATE_REQUEST') {
    const first = claimTitanDelegationLease({ envelope, claimant_id: 'worker-a', claimant_tier: 'WORKER', now: '2026-09-13T00:00:00.000Z', ttl_ms: 5_000 });
    const duplicate = claimTitanDelegationLease({ envelope, claimant_id: 'worker-a', claimant_tier: 'WORKER', now: '2026-09-13T00:00:01.000Z', ttl_ms: 5_000, existing_lease: first });
    return Object.freeze({ ...baseResult(scenario, envelope), first_token: first.lease_token, duplicate_token: duplicate.lease_token, first_generation: first.generation, duplicate_generation: duplicate.generation, invariant_passed: duplicate.lease_token === first.lease_token && duplicate.generation === first.generation });
  }

  if (scenario === 'PARTIAL_FAILURE') {
    const retryPolicy = Object.freeze({ evaluate: () => Object.freeze({ failure_class: 'TRANSIENT', retry_allowed: true, retry_after_ms: 250, requires_explicit_resume: false }) });
    const plan = await planTitanDelegationRecovery({
      envelope,
      failed_step_id: 'step-2',
      failure: { code: 'provider_unavailable' },
      retry_policy: retryPolicy,
      steps: [
        { step_id: 'step-1', operation_kind: 'internal_write', status: 'SUCCEEDED', dispatch_proven: true, retry_count: 0, idempotency_key: 'step-1', compensatable: true, compensation_command: 'undo-step-1' },
        { step_id: 'step-2', operation_kind: 'provider_read', status: 'FAILED', dispatch_proven: false, retry_count: 0, idempotency_key: 'step-2', compensatable: false },
      ],
    });
    return Object.freeze({ ...baseResult(scenario, envelope), action: plan.action, partial_failure: plan.partial_failure, uncertain_effect: plan.uncertain_effect, retry_allowed: plan.retry_allowed, retry_after_ms: plan.retry_after_ms, invariant_passed: plan.action === 'RETRY' && plan.partial_failure && !plan.uncertain_effect && plan.retry_allowed });
  }

  const authorityOrder: readonly TitanDelegationAuthorityCeiling[] = ['READ_ONLY', 'PROPOSE', 'WRITE_INTERNAL', 'EXTERNAL_COMMUNICATION', 'FINANCIAL', 'DESTRUCTIVE'];
  const parentAuthorityIndex = authorityOrder.indexOf(envelope.authority_ceiling);
  const contractedAuthority = parentAuthorityIndex <= 0 ? 'READ_ONLY' : authorityOrder[parentAuthorityIndex - 1];
  const widenedAuthority = parentAuthorityIndex < authorityOrder.length - 1 ? authorityOrder[parentAuthorityIndex + 1] : null;
  const contracted = createTitanDelegationHandoff({
    parent_envelope: envelope,
    from_candidate_id: 'agent-a',
    to_candidate_id: 'worker-a',
    to_tier: 'WORKER',
    child_delegation_id: 'simulation-child',
    child_objective: 'perform constrained work',
    child_idempotency_key: 'simulation-child-idempotency',
    requested_authority: contractedAuthority,
  });
  const widenedError = widenedAuthority == null ? 'delegation-handoff-authority-at-maximum' : errorCode(() => createTitanDelegationHandoff({
    parent_envelope: envelope,
    from_candidate_id: 'agent-a',
    to_candidate_id: 'worker-b',
    to_tier: 'WORKER',
    child_delegation_id: 'simulation-child-widened',
    child_objective: 'attempt widened work',
    child_idempotency_key: 'simulation-child-widened-idempotency',
    requested_authority: widenedAuthority,
  }));
  const contractionValid = authorityOrder.indexOf(contracted.child_envelope.authority_ceiling) <= parentAuthorityIndex;
  const wideningRejected = widenedAuthority == null
    ? widenedError === 'delegation-handoff-authority-at-maximum'
    : widenedError === 'delegation-handoff-authority-exceeds-parent';
  return Object.freeze({ ...baseResult(scenario, envelope), parent_authority: envelope.authority_ceiling, child_authority: contracted.child_envelope.authority_ceiling, widening_error: widenedError, invariant_passed: contractionValid && wideningRejected });
}

export async function runTitanDelegationSimulationSuite(input?: { envelope?: TitanDelegationSimulationEnvelope }) {
  const results = [];
  for (const scenario of TITAN_DELEGATION_SIMULATION_SCENARIOS) {
    results.push(await runTitanDelegationSimulation({ scenario, envelope: input?.envelope }));
  }
  return Object.freeze({
    schema: 'titan.workforce.delegation-simulation-suite.v1' as const,
    scenario_count: results.length,
    passed: results.every((result) => result.invariant_passed === true),
    results: Object.freeze(results),
    deterministic: true as const,
    side_effect_free: true as const,
    grants_authority: false as const,
    authority_effect: false as const,
    execution_permitted: false as const,
  });
}

export type TitanDelegationSimulationLease = TitanDelegationLease;
