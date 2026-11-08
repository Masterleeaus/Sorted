import type {
  TitanWorkforceAssignmentCompatibility,
  TitanWorkforceHealthProjection,
  TitanWorkforceLifecycleRuntime,
  TitanWorkforceLifecycleState,
  TitanWorkforceMigrationPlan,
  TitanWorkforceReplacementPlan,
  TitanWorkforceRetirementPlan,
} from '../../../../../packages/titan-platform/src/workforce-lifecycle/index.js';

export const TITAN_WORKFORCE_LIFECYCLE_UI_CONTRACT = Object.freeze({
  schema: 'titan.workforce.lifecycle-ui.contract.v1',
  existingSettingsSurface: true as const,
  existingWorkforceSurface: true as const,
  replacesExistingUi: false as const,
  ownsMarketplaceInstall: false as const,
  ownsMarketplaceUninstall: false as const,
  directMutationActions: false as const,
  freshAuthorityEvaluationRequired: true as const,
  grantsAuthority: false as const,
});

export type WorkforceLifecycleControlIntent = Readonly<{
  id: 'ENABLE' | 'PAUSE' | 'RESUME' | 'DISABLE' | 'PREPARE_UPGRADE' | 'PREPARE_REPLACEMENT' | 'PREPARE_RETIREMENT';
  label: string;
  available: boolean;
  reason: string;
  request_only: true;
  requires_fresh_authority_evaluation: true;
  execution_permitted: false;
  grants_authority: false;
}>;

export type WorkforceLifecycleInspectionView = Readonly<{
  schema: 'titan.workforce.lifecycle-ui-inspection.v1';
  company_id: string;
  agent_key: string;
  lifecycle_state: TitanWorkforceLifecycleState;
  health_state: TitanWorkforceHealthProjection['health_state'];
  active_work_count: number;
  accepts_new_assignments: boolean;
  compatible: boolean;
  status_reasons: readonly string[];
  controls: readonly WorkforceLifecycleControlIntent[];
  migration_phase: TitanWorkforceMigrationPlan['phase'] | null;
  replacement_phase: TitanWorkforceReplacementPlan['phase'] | null;
  retirement_phase: TitanWorkforceRetirementPlan['phase'] | null;
  read_only_projection: true;
  marketplace_owned: false;
  mutation_actions: readonly never[];
  execution_permitted: false;
  grants_authority: false;
}>;

function intent(
  id: WorkforceLifecycleControlIntent['id'],
  label: string,
  available: boolean,
  reason: string,
): WorkforceLifecycleControlIntent {
  return Object.freeze({
    id,
    label,
    available,
    reason,
    request_only: true,
    requires_fresh_authority_evaluation: true,
    execution_permitted: false,
    grants_authority: false,
  });
}

export function buildWorkforceLifecycleInspectionView(input: {
  company_id: string;
  runtime: TitanWorkforceLifecycleRuntime;
  health: TitanWorkforceHealthProjection;
  compatibility: TitanWorkforceAssignmentCompatibility;
  migration?: TitanWorkforceMigrationPlan | null;
  replacement?: TitanWorkforceReplacementPlan | null;
  retirement?: TitanWorkforceRetirementPlan | null;
}): WorkforceLifecycleInspectionView {
  const { runtime, health, compatibility } = input;
  if (!input.company_id) throw new Error('company_id-required');
  if (runtime.company_id !== input.company_id || health.company_id !== input.company_id || compatibility.company_id !== input.company_id) {
    throw new Error('cross-company-lifecycle-ui-projection');
  }
  if (runtime.agent_key !== health.agent_key || runtime.agent_key !== compatibility.agent_key) {
    throw new Error('lifecycle-ui-agent-evidence-mismatch');
  }

  const reasons = [...new Set([
    ...health.readiness_reasons,
    ...compatibility.reasons,
    ...(input.migration?.blockers ?? []),
    ...(input.replacement?.blockers ?? []),
    ...(input.retirement?.blockers ?? []),
  ])].sort();

  const zeroWork = runtime.active_work_count === 0;
  const ready = health.health_state === 'READY';
  const state = runtime.lifecycle_state;
  const controls = Object.freeze([
    intent('ENABLE', 'Enable', (state === 'REGISTERED' || state === 'DISABLED') && ready && zeroWork,
      ready ? (zeroWork ? 'Request enable through governed lifecycle authority.' : 'Active work must be zero before enable.') : 'Agent health must be READY.'),
    intent('PAUSE', 'Pause', state === 'ENABLED', state === 'ENABLED' ? 'Pause blocks new assignments and preserves active work.' : 'Only enabled agents can be paused.'),
    intent('RESUME', 'Resume', state === 'PAUSED' && ready, state === 'PAUSED' && ready ? 'Resume requires fresh authority evaluation.' : 'Agent must be PAUSED and READY.'),
    intent('DISABLE', 'Disable', ['ENABLED', 'PAUSED', 'DEGRADED'].includes(state), ['ENABLED', 'PAUSED', 'DEGRADED'].includes(state) ? 'Disable drains active work when required.' : 'Lifecycle state is not disable-eligible.'),
    intent('PREPARE_UPGRADE', 'Prepare upgrade', zeroWork && ['REGISTERED', 'DISABLED', 'PAUSED'].includes(state), zeroWork ? 'Prepare a rollback-safe migration plan; this does not apply it.' : 'Drain active work before upgrade preparation.'),
    intent('PREPARE_REPLACEMENT', 'Prepare replacement', ['ENABLED', 'PAUSED', 'DRAINING', 'DISABLED'].includes(state), 'Replacement requires a distinct READY compatible target and explicit continuity evidence.'),
    intent('PREPARE_RETIREMENT', 'Prepare retirement', zeroWork && ['REGISTERED', 'DISABLED'].includes(state), zeroWork ? 'Retirement requires dependency, orphan-prevention, retention and Manager approval evidence.' : 'Active work must be zero before retirement.'),
  ]);

  return Object.freeze({
    schema: 'titan.workforce.lifecycle-ui-inspection.v1',
    company_id: input.company_id,
    agent_key: runtime.agent_key,
    lifecycle_state: state,
    health_state: health.health_state,
    active_work_count: runtime.active_work_count,
    accepts_new_assignments: health.accepts_new_assignments && compatibility.assignable,
    compatible: compatibility.compatible,
    status_reasons: Object.freeze(reasons),
    controls,
    migration_phase: input.migration?.phase ?? null,
    replacement_phase: input.replacement?.phase ?? null,
    retirement_phase: input.retirement?.phase ?? null,
    read_only_projection: true,
    marketplace_owned: false,
    mutation_actions: Object.freeze([]),
    execution_permitted: false,
    grants_authority: false,
  });
}
