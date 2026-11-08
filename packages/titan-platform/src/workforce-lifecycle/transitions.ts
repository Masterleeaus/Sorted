import {
  TITAN_WORKFORCE_LIFECYCLE_CONTRACT,
  assertTitanWorkforceLifecycleCompany,
  isTitanWorkforceAssignableState,
  type TitanWorkforceHealthState,
  type TitanWorkforceLifecycleState,
} from './contracts.js';

export const TITAN_WORKFORCE_LIFECYCLE_TRANSITION_CONTRACT = Object.freeze({
  schema: 'titan.workforce.lifecycle-transition.contract.v1',
  companyBoundary: 'company_id' as const,
  lifecycleAuthority: TITAN_WORKFORCE_LIFECYCLE_CONTRACT.lifecycleAuthority,
  transitionGrantsAuthority: false as const,
  automaticExecutionEnablement: false as const,
  activeWorkCancellationOnPause: false as const,
  activeWorkCancellationOnDisable: false as const,
  disableUsesDrainWhenActive: true as const,
  newAssignmentsAllowedWhileDraining: false as const,
});

export type TitanWorkforceLifecycleAction = 'ENABLE' | 'PAUSE' | 'RESUME' | 'DISABLE' | 'DRAIN_TICK';

export type TitanWorkforceLifecycleRuntime = Readonly<{
  schema: 'titan.workforce.lifecycle-runtime.v1';
  company_id: string;
  agent_key: string;
  lifecycle_state: TitanWorkforceLifecycleState;
  health_state: TitanWorkforceHealthState;
  active_work_count: number;
  accepts_new_assignments: boolean;
  execution_permitted: false;
  identity_grants_authority: false;
  transition_grants_authority: false;
  drain_reason: string | null;
}>;

export type TitanWorkforceLifecycleTransition = Readonly<{
  schema: 'titan.workforce.lifecycle-transition.v1';
  company_id: string;
  agent_key: string;
  action: TitanWorkforceLifecycleAction;
  from_state: TitanWorkforceLifecycleState;
  to_state: TitanWorkforceLifecycleState;
  active_work_before: number;
  active_work_after: number;
  accepts_new_assignments: boolean;
  execution_permitted: false;
  transition_grants_authority: false;
  reason: string;
}>;

function cleanId(value: unknown, field: string): string {
  const result = String(value ?? '').trim().toLowerCase();
  if (!result) throw new Error(`${field}-required`);
  return result;
}

function cleanCount(value: unknown): number {
  const count = Number(value ?? 0);
  if (!Number.isInteger(count) || count < 0) throw new Error('active_work_count-invalid');
  return count;
}

function assignmentState(state: TitanWorkforceLifecycleState, health: TitanWorkforceHealthState): boolean {
  return isTitanWorkforceAssignableState(state, health);
}

export function createTitanWorkforceLifecycleRuntime(input: {
  company_id: string;
  agent_key: string;
  lifecycle_state?: TitanWorkforceLifecycleState;
  health_state?: TitanWorkforceHealthState;
  active_work_count?: number;
  drain_reason?: string | null;
}): TitanWorkforceLifecycleRuntime {
  const company_id = assertTitanWorkforceLifecycleCompany(input.company_id);
  const agent_key = cleanId(input.agent_key, 'agent_key');
  const lifecycle_state = input.lifecycle_state ?? 'REGISTERED';
  const health_state = input.health_state ?? 'READY';
  const active_work_count = cleanCount(input.active_work_count);
  if (lifecycle_state === 'RETIRED') throw new Error('retired-runtime-not-active');
  if (lifecycle_state === 'DRAINING' && active_work_count === 0) throw new Error('draining-requires-active-work');
  return Object.freeze({
    schema: 'titan.workforce.lifecycle-runtime.v1',
    company_id,
    agent_key,
    lifecycle_state,
    health_state,
    active_work_count,
    accepts_new_assignments: assignmentState(lifecycle_state, health_state),
    execution_permitted: false,
    identity_grants_authority: false,
    transition_grants_authority: false,
    drain_reason: input.drain_reason == null ? null : String(input.drain_reason).trim() || null,
  });
}

function transitionResult(runtime: TitanWorkforceLifecycleRuntime, action: TitanWorkforceLifecycleAction, to_state: TitanWorkforceLifecycleState, active_work_after: number, reason: string): {runtime: TitanWorkforceLifecycleRuntime; transition: TitanWorkforceLifecycleTransition} {
  const next = createTitanWorkforceLifecycleRuntime({
    company_id: runtime.company_id,
    agent_key: runtime.agent_key,
    lifecycle_state: to_state,
    health_state: runtime.health_state,
    active_work_count: active_work_after,
    drain_reason: to_state === 'DRAINING' ? reason : null,
  });
  const transition = Object.freeze({
    schema: 'titan.workforce.lifecycle-transition.v1' as const,
    company_id: runtime.company_id,
    agent_key: runtime.agent_key,
    action,
    from_state: runtime.lifecycle_state,
    to_state,
    active_work_before: runtime.active_work_count,
    active_work_after,
    accepts_new_assignments: next.accepts_new_assignments,
    execution_permitted: false as const,
    transition_grants_authority: false as const,
    reason,
  });
  return Object.freeze({runtime: next, transition});
}

export function transitionTitanWorkforceLifecycle(runtime: TitanWorkforceLifecycleRuntime, action: TitanWorkforceLifecycleAction, input: {company_id: string; active_work_count?: number; reason?: string}): {runtime: TitanWorkforceLifecycleRuntime; transition: TitanWorkforceLifecycleTransition} {
  const company_id = assertTitanWorkforceLifecycleCompany(input.company_id);
  if (company_id !== runtime.company_id) throw new Error('cross-company-lifecycle-transition');
  const reason = String(input.reason ?? action.toLowerCase()).trim() || action.toLowerCase();
  const active = input.active_work_count == null ? runtime.active_work_count : cleanCount(input.active_work_count);

  if (runtime.lifecycle_state === 'RETIRED') throw new Error('retired-agent-transition-forbidden');

  if (action === 'ENABLE') {
    if (!['REGISTERED', 'DISABLED'].includes(runtime.lifecycle_state)) throw new Error(`enable-invalid-from:${runtime.lifecycle_state}`);
    if (runtime.health_state !== 'READY') throw new Error(`enable-health-not-ready:${runtime.health_state}`);
    if (active !== 0) throw new Error('enable-requires-zero-active-work');
    return transitionResult(runtime, action, 'ENABLED', 0, reason);
  }

  if (action === 'PAUSE') {
    if (runtime.lifecycle_state !== 'ENABLED') throw new Error(`pause-invalid-from:${runtime.lifecycle_state}`);
    return transitionResult(runtime, action, 'PAUSED', active, reason);
  }

  if (action === 'RESUME') {
    if (runtime.lifecycle_state !== 'PAUSED') throw new Error(`resume-invalid-from:${runtime.lifecycle_state}`);
    if (runtime.health_state !== 'READY') throw new Error(`resume-health-not-ready:${runtime.health_state}`);
    return transitionResult(runtime, action, 'ENABLED', active, reason);
  }

  if (action === 'DISABLE') {
    if (!['ENABLED', 'PAUSED', 'DEGRADED'].includes(runtime.lifecycle_state)) throw new Error(`disable-invalid-from:${runtime.lifecycle_state}`);
    if (active > 0) return transitionResult(runtime, action, 'DRAINING', active, reason);
    return transitionResult(runtime, action, 'DISABLED', 0, reason);
  }

  if (action === 'DRAIN_TICK') {
    if (runtime.lifecycle_state !== 'DRAINING') throw new Error(`drain-invalid-from:${runtime.lifecycle_state}`);
    if (active > runtime.active_work_count) throw new Error('drain-active-work-cannot-increase');
    if (active === 0) return transitionResult(runtime, action, 'DISABLED', 0, reason);
    return transitionResult(runtime, action, 'DRAINING', active, reason);
  }

  throw new Error(`unsupported-lifecycle-action:${action satisfies never}`);
}
