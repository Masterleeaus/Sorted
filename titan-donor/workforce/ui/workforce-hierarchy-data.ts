import graph from '../../../../../packages/titan-platform/src/ported/titan-workforce/hierarchy/workforce-organizational-graph.json';

export type WorkforceHierarchyInspectionRow = Readonly<{
  tier: 'manager' | 'supervisor' | 'agent' | 'worker';
  id: string;
  label: string;
  parentId: string | null;
  domain: string | null;
  state: 'active' | 'catalogue';
  executionAuthority: false;
}>;

export type WorkforceHierarchyInspection = Readonly<{
  schema: 'titan.workforce.hierarchy-ui-inspection.v1';
  companyId: string;
  rows: readonly WorkforceHierarchyInspectionRow[];
  counts: Readonly<{ managers: number; supervisors: number; agents: number; workers: number }>;
  readOnly: true;
  executionPermitted: false;
  grantsAuthority: false;
  source: 'workforce-organizational-graph';
}>;

type RoleNode = {
  role_definition_id: string;
  name: string;
  division_key: string;
  workforce_tier: 'manager' | 'supervisor' | 'specialist';
  reports_to?: string | null;
};

type OrchestratorNode = { agent_key: string; name: string; primary_role_affinity: string };
type WorkerNode = { worker_id: string; name: string; reports_to_specialist: string };

export function loadWorkforceHierarchyInspection(companyId: string): WorkforceHierarchyInspection {
  const companyIdNormalized = String(companyId ?? '').trim();
  if (!companyIdNormalized) throw new Error('company_id-required');

  const roles = [
    ...(graph.catalogue_hierarchy as RoleNode[]),
    ...(graph.supplemental_supervisors as RoleNode[]),
  ];
  const roleById = new Map(roles.map((role) => [role.role_definition_id, role] as const));
  const supplementalByDivision = new Map(
    (graph.supplemental_supervisors as RoleNode[]).map((role) => [role.division_key, role] as const),
  );

  const rows = new Map<string, WorkforceHierarchyInspectionRow>();
  const put = (row: WorkforceHierarchyInspectionRow) => rows.set(`${row.tier}:${row.id}`, Object.freeze(row));

  function managerFor(role: RoleNode | undefined): RoleNode | null {
    let current = role;
    const seen = new Set<string>();
    while (current && !seen.has(current.role_definition_id)) {
      seen.add(current.role_definition_id);
      if (current.workforce_tier === 'manager') return current;
      current = current.reports_to ? roleById.get(current.reports_to) : undefined;
    }
    return null;
  }

  function supervisorFor(role: RoleNode | undefined): RoleNode | null {
    let current = role;
    const seen = new Set<string>();
    while (current && !seen.has(current.role_definition_id)) {
      seen.add(current.role_definition_id);
      if (current.workforce_tier === 'supervisor') return current;
      current = current.reports_to ? roleById.get(current.reports_to) : undefined;
    }
    return role ? supplementalByDivision.get(role.division_key) ?? null : null;
  }

  const workers = graph.atomic_workers as WorkerNode[];
  for (const orchestrator of graph.orchestrators as OrchestratorNode[]) {
    const affinity = roleById.get(orchestrator.primary_role_affinity);
    const supervisor = supervisorFor(affinity);
    const manager = managerFor(supervisor ?? affinity);

    if (manager) {
      put({
        tier: 'manager',
        id: manager.role_definition_id,
        label: manager.name,
        parentId: null,
        domain: manager.division_key,
        state: 'catalogue',
        executionAuthority: false,
      });
    }

    if (supervisor) {
      put({
        tier: 'supervisor',
        id: supervisor.role_definition_id,
        label: supervisor.name,
        parentId: manager?.role_definition_id ?? null,
        domain: supervisor.division_key,
        state: 'catalogue',
        executionAuthority: false,
      });
    }

    const agentId = `agent:${orchestrator.agent_key}`;
    put({
      tier: 'agent',
      id: agentId,
      label: orchestrator.name,
      parentId: supervisor?.role_definition_id ?? manager?.role_definition_id ?? null,
      domain: affinity?.division_key ?? null,
      state: 'active',
      executionAuthority: false,
    });

    for (const worker of workers.filter((candidate) => candidate.reports_to_specialist === orchestrator.primary_role_affinity)) {
      put({
        tier: 'worker',
        id: worker.worker_id,
        label: worker.name,
        parentId: agentId,
        domain: affinity?.division_key ?? null,
        state: 'catalogue',
        executionAuthority: false,
      });
    }
  }

  const ordered = [...rows.values()].sort((a, b) => {
    const order = { manager: 0, supervisor: 1, agent: 2, worker: 3 } as const;
    return order[a.tier] - order[b.tier] || (a.domain ?? '').localeCompare(b.domain ?? '') || a.label.localeCompare(b.label);
  });

  return Object.freeze({
    schema: 'titan.workforce.hierarchy-ui-inspection.v1',
    companyId: companyIdNormalized,
    rows: Object.freeze(ordered),
    counts: Object.freeze({
      managers: ordered.filter((row) => row.tier === 'manager').length,
      supervisors: ordered.filter((row) => row.tier === 'supervisor').length,
      agents: ordered.filter((row) => row.tier === 'agent').length,
      workers: ordered.filter((row) => row.tier === 'worker').length,
    }),
    readOnly: true,
    executionPermitted: false,
    grantsAuthority: false,
    source: 'workforce-organizational-graph',
  });
}
