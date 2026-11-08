import {
  routeTitanDelegationTask,
  type TitanDelegationAuthorityCeiling,
} from './index.js';
import {
  TITAN_DELEGATION_SIMULATION_SCENARIOS,
  runTitanDelegationSimulation,
  type TitanDelegationSimulationScenario,
} from './simulation.js';

export type TitanDelegationWorkloadCertificationOptions = Readonly<{
  workload_count?: number;
  company_count?: number;
}>;

const MAX_WORKLOAD_COUNT = 5_000;
const MAX_COMPANY_COUNT = 500;

function boundedInteger(value: unknown, fallback: number, max: number, code: string): number {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new Error(code);
  return parsed;
}

function authorityFor(index: number): TitanDelegationAuthorityCeiling {
  return index % 4 === 0 ? 'READ_ONLY' : index % 4 === 1 ? 'PROPOSE' : index % 4 === 2 ? 'WRITE_INTERNAL' : 'EXTERNAL_COMMUNICATION';
}

/**
 * Runs deterministic, side-effect-free workload certification only.
 * It reuses the canonical routing and simulation contracts and never persists,
 * executes, mutates business state or grants authority.
 */
export async function runTitanDelegationWorkloadCertification(options: TitanDelegationWorkloadCertificationOptions = {}) {
  const workloadCount = boundedInteger(options.workload_count, 100, MAX_WORKLOAD_COUNT, 'delegation-certification-workload-count-invalid');
  const companyCount = boundedInteger(options.company_count, Math.min(10, workloadCount), Math.min(MAX_COMPANY_COUNT, workloadCount), 'delegation-certification-company-count-invalid');
  const scenarioCounts: Record<TitanDelegationSimulationScenario, number> = Object.fromEntries(
    TITAN_DELEGATION_SIMULATION_SCENARIOS.map((scenario) => [scenario, 0]),
  ) as Record<TitanDelegationSimulationScenario, number>;

  let routeSelections = 0;
  let routeFailures = 0;
  let simulationFailures = 0;
  let authorityViolations = 0;
  let executionPermissionLeaks = 0;
  let crossCompanyLeaks = 0;

  for (let index = 0; index < workloadCount; index += 1) {
    const company_id = `cert-company-${index % companyCount}`;
    const delegation_id = `cert-delegation-${index}`;
    const authority_ceiling = authorityFor(index);
    const envelope = {
      company_id,
      delegation_id,
      objective: `certify workload ${index}`,
      inputs: { workload_index: index },
      authority_ceiling,
      priority: index % 10 === 0 ? 'URGENT' as const : 'NORMAL' as const,
      idempotency_key: `cert-idem-${index}`,
      causality: {
        correlation_id: `cert-correlation-${index}`,
        root_delegation_id: delegation_id,
      },
      expected_outcome: { description: 'workload certification invariant holds' },
    };

    const route = routeTitanDelegationTask({
      envelope,
      required_capabilities: ['certification'],
      required_scopes: ['delegation'],
      required_authority: authority_ceiling,
    }, [
      {
        company_id: `foreign-${company_id}`,
        candidate_id: `foreign-worker-${index}`,
        tier: 'WORKER',
        capabilities: ['certification'],
        scopes: ['delegation'],
        authority_ceiling: 'DESTRUCTIVE',
        active_workload: 0,
        max_workload: 10,
      },
      {
        company_id,
        candidate_id: `worker-${index}`,
        tier: 'WORKER',
        capabilities: ['certification'],
        scopes: ['delegation'],
        authority_ceiling,
        active_workload: index % 3,
        max_workload: 10,
      },
      {
        company_id,
        candidate_id: `agent-${index}`,
        tier: 'AGENT',
        capabilities: ['certification'],
        scopes: ['delegation'],
        authority_ceiling: 'DESTRUCTIVE',
        active_workload: 9,
        max_workload: 10,
      },
    ]);

    if (route.status === 'ROUTE_SELECTED') routeSelections += 1;
    else routeFailures += 1;
    if (route.company_id !== company_id || route.selected_candidate_id?.startsWith('foreign-')) crossCompanyLeaks += 1;
    if (route.grants_authority !== false || route.execution_permitted !== false) {
      authorityViolations += route.grants_authority === false ? 0 : 1;
      executionPermissionLeaks += route.execution_permitted === false ? 0 : 1;
    }

    const scenario = TITAN_DELEGATION_SIMULATION_SCENARIOS[index % TITAN_DELEGATION_SIMULATION_SCENARIOS.length];
    scenarioCounts[scenario] += 1;
    const simulation = await runTitanDelegationSimulation({ scenario, envelope });
    if (!simulation.invariant_passed) simulationFailures += 1;
    if (simulation.company_id !== company_id || simulation.delegation_id !== delegation_id) crossCompanyLeaks += 1;
    if (simulation.grants_authority !== false || simulation.authority_effect !== false) authorityViolations += 1;
    if (simulation.execution_permitted !== false) executionPermissionLeaks += 1;
  }

  const canonicalSeams = Object.freeze([
    Object.freeze({ seam: 'routing', owner: 'workforce-delegation.routeTitanDelegationTask', disposition: 'RETAIN', reason: 'single delegation candidate selector; no duplicate local selector found' }),
    Object.freeze({ seam: 'workflow_execution', owner: 'titan-modules/workflow-runtime', disposition: 'RETAIN', reason: 'delegation does not execute workflows' }),
    Object.freeze({ seam: 'authority', owner: 'titan-runtime/authority', disposition: 'RETAIN', reason: 'delegation identity and coordination do not grant authority' }),
    Object.freeze({ seam: 'retry_policy', owner: 'titan-workforce/gateway/failure-retry', disposition: 'RETAIN', reason: 'delegation recovery adapts canonical failure classification' }),
    Object.freeze({ seam: 'event_persistence', owner: 'Titan event ledger / workforce observability', disposition: 'RETAIN', reason: 'delegation telemetry is projection-only' }),
  ]);

  const passed = routeFailures === 0
    && simulationFailures === 0
    && authorityViolations === 0
    && executionPermissionLeaks === 0
    && crossCompanyLeaks === 0;

  return Object.freeze({
    schema: 'titan.workforce.delegation-workload-certification.v1' as const,
    workload_count: workloadCount,
    company_count: companyCount,
    route_selections: routeSelections,
    route_failures: routeFailures,
    simulation_failures: simulationFailures,
    scenario_counts: Object.freeze({ ...scenarioCounts }),
    authority_violations: authorityViolations,
    execution_permission_leaks: executionPermissionLeaks,
    cross_company_leaks: crossCompanyLeaks,
    canonical_seams: canonicalSeams,
    removed_redundant_seams: Object.freeze([] as string[]),
    removal_assessment: 'NO_SAFE_REDUNDANT_ROUTING_SEAM_FOUND' as const,
    passed,
    deterministic: true as const,
    side_effect_free: true as const,
    grants_authority: false as const,
    authority_effect: false as const,
    execution_permitted: false as const,
  });
}
