import {
  createTitanWorkforceLifecycleRuntime,
  declarationFromStarterAgent,
  evaluateTitanWorkforceAssignmentCompatibility,
  projectTitanWorkforceHealth,
} from '../../../../../packages/titan-platform/src/workforce-lifecycle/index.js';
import { listStarterAgents } from '../../../../../packages/titan-platform/src/ported/titan-workforce/starter-agents/starter-agent-registry.js';
import { buildWorkforceLifecycleInspectionView, type WorkforceLifecycleInspectionView } from '../../../lib/titan/workforce-lifecycle/inspection.js';
import { FIELD_RUNTIME_AGENT_KEYS } from '../../../lib/titan-go/field-workforce';

export function loadWorkforceLifecycleInspection(companyId: string): readonly WorkforceLifecycleInspectionView[] {
  const company_id = String(companyId ?? '').trim();
  if (!company_id) throw new Error('company_id-required');

  const fieldAgentKeys = new Set<string>(FIELD_RUNTIME_AGENT_KEYS);
  const fieldAgents = listStarterAgents().filter((agent: any) => fieldAgentKeys.has(String(agent.agent_key)));

  return Object.freeze(fieldAgents.map((agent: any) => {
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
      capabilities: [{
        capability_id: `${agent.agent_key}.inspection`,
        version: '1.0.0',
        description: 'Read-only lifecycle inspection capability',
        operations: [],
      }],
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
