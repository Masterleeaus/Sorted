import {
  createTitanWorkforceLifecycleRuntime,
  declarationFromStarterAgent,
  evaluateTitanWorkforceAssignmentCompatibility,
  projectTitanWorkforceHealth,
} from '../../../../../packages/titan-platform/src/workforce-lifecycle/index.js';
import { listStarterAgents } from '../../../../../packages/titan-platform/src/ported/titan-workforce/starter-agents/starter-agent-registry.js';
import { buildWorkforceLifecycleInspectionView, type WorkforceLifecycleInspectionView } from '../../../lib/titan/workforce-lifecycle/inspection.js';

export function loadWorkforceLifecycleInspection(companyId: string): readonly WorkforceLifecycleInspectionView[] {
  const company_id = String(companyId ?? '').trim();
  if (!company_id) throw new Error('company_id-required');

  return Object.freeze(listStarterAgents().map((agent: any) => {
    const lifecycle_state = agent.enabled === true ? 'ENABLED' as const : 'REGISTERED' as const;
    const runtime = createTitanWorkforceLifecycleRuntime({
      company_id,
      agent_key: agent.agent_key,
      lifecycle_state,
      health_state: 'READY',
      active_work_count: 0,
    });
    const health = projectTitanWorkforceHealth({
      company_id,
      agent_key: agent.agent_key,
      lifecycle_state,
      health_state: 'READY',
    });
    const registration = declarationFromStarterAgent({
      company_id,
      agent_key: agent.agent_key,
      agent_version: '1.0.0',
      capabilities: [],
      configuration: { source: 'starter-agent-registry', read_only_projection: true },
    });
    const compatibility = evaluateTitanWorkforceAssignmentCompatibility({
      company_id,
      registration,
      health,
      required_domains: agent.operational_domains ?? [],
    });

    return buildWorkforceLifecycleInspectionView({
      company_id,
      runtime,
      health,
      compatibility,
    });
  }));
}
