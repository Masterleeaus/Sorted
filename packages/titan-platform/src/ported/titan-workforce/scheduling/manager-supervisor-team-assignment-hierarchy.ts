// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/scheduling/manager-supervisor-team-assignment-hierarchy.mjs
const SCHEMA = 'titan.workforce.manager-supervisor-team-assignment-hierarchy.v1';

const list = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 180) => String(value ?? '').trim().slice(0, max);
const uniq = (values) => [...new Set(list(values).map((value) => clean(value)).filter(Boolean))].sort();

function rejectLegacyBoundary(value, label) {
  if (value && (Object.hasOwn(value, 'tenant_id') || Object.hasOwn(value, 'tenant_company_id'))) {
    throw new Error(`${label}-legacy-tenant-boundary-rejected`);
  }
}

function requireCompanyId(value, label = 'input') {
  const companyId = clean(value, 128);
  if (!/^[A-Za-z0-9._:-]{2,128}$/.test(companyId)) {
    throw new Error(`${label}-company_id-required`);
  }
  return companyId;
}

function assertCompany(value, companyId, label) {
  rejectLegacyBoundary(value, label);
  if (value?.company_id && value.company_id !== companyId) {
    throw new Error(`${label}-cross-company-rejected`);
  }
}

function assertGraph(graph, companyId) {
  rejectLegacyBoundary(graph, 'workforce-graph');
  if (graph?.schema !== 'titan.workforce.graph.v1') {
    throw new Error('assignment-hierarchy-workforce-graph-required');
  }
  if (graph.company_id !== companyId) {
    throw new Error('assignment-hierarchy-cross-company-graph-rejected');
  }
}

function workerIds(graph) {
  return new Set(
    list(graph?.nodes)
      .filter((node) => node?.company_id === graph.company_id && node?.kind === 'worker')
      .map((node) => clean(node.entity_id || String(node.node_id || '').replace(/^worker:/, '')))
      .filter(Boolean)
  );
}

function directReports(graph) {
  const result = new Map();
  for (const edge of list(graph?.edges)) {
    if (edge?.company_id !== graph.company_id || edge?.type !== 'REPORTS_TO') continue;
    const workerId = clean(String(edge.from || '').replace(/^worker:/, ''));
    const supervisorId = clean(String(edge.to || '').replace(/^worker:/, ''));
    if (!workerId || !supervisorId) continue;
    if (!result.has(supervisorId)) result.set(supervisorId, new Set());
    result.get(supervisorId).add(workerId);
  }
  return result;
}

function validateAcyclic(graph) {
  const parentByWorker = new Map();
  for (const edge of list(graph?.edges)) {
    if (edge?.company_id !== graph.company_id || edge?.type !== 'REPORTS_TO') continue;
    const workerId = clean(String(edge.from || '').replace(/^worker:/, ''));
    const supervisorId = clean(String(edge.to || '').replace(/^worker:/, ''));
    if (!workerId || !supervisorId) continue;
    if (!parentByWorker.has(workerId)) parentByWorker.set(workerId, new Set());
    parentByWorker.get(workerId).add(supervisorId);
  }
  for (const start of parentByWorker.keys()) {
    const stack = [[start, new Set([start])]];
    while (stack.length) {
      const [current, seen] = stack.pop();
      for (const parent of parentByWorker.get(current) || []) {
        if (seen.has(parent)) throw new Error('assignment-hierarchy-reporting-cycle-rejected');
        stack.push([parent, new Set([...seen, parent])]);
      }
    }
  }
}

function normalizeSupervision(record, companyId, workers) {
  assertCompany(record, companyId, 'supervision-record');
  if (record?.schema !== 'titan.workforce.supervision.v1') {
    throw new Error('assignment-hierarchy-supervision-record-invalid');
  }
  const supervisorWorkerId = clean(record.supervisor_worker_id);
  if (!supervisorWorkerId || !workers.has(supervisorWorkerId)) {
    throw new Error('assignment-hierarchy-supervisor-not-in-graph');
  }
  return {
    supervisor_worker_id: supervisorWorkerId,
    scoped_worker_ids: uniq(record.scope?.scoped_worker_ids),
    subordinate_worker_ids: uniq(record.scope?.subordinate_worker_ids),
    direct_subordinate_worker_ids: uniq(record.scope?.direct_subordinate_worker_ids),
    coordination_state: clean(record.coordination_state, 60) || 'active',
    grants_authority: false
  };
}

function normalizeMissionTeam(record, companyId, workers) {
  assertCompany(record, companyId, 'mission-team');
  if (record?.schema !== 'titan.workforce.mission-team.v1') {
    throw new Error('assignment-hierarchy-mission-team-invalid');
  }
  const supervisor = clean(record.supervisor_worker_id) || null;
  const coordinator = clean(record.coordinator_worker_id) || null;
  if (supervisor && !workers.has(supervisor)) throw new Error('assignment-hierarchy-team-supervisor-not-in-graph');
  if (coordinator && !workers.has(coordinator)) throw new Error('assignment-hierarchy-team-coordinator-not-in-graph');
  const members = uniq(list(record.members).map((member) => member?.worker_id));
  for (const member of members) {
    if (!workers.has(member)) throw new Error('assignment-hierarchy-team-member-not-in-graph');
  }
  return {
    mission_team_id: clean(record.mission_team_id),
    mission_id: clean(record.mission_id) || null,
    state: clean(record.state, 40) || null,
    supervisor_worker_id: supervisor,
    coordinator_worker_id: coordinator,
    member_worker_ids: members,
    grants_authority: false
  };
}

function candidateIndex(candidateMatch, companyId) {
  if (!candidateMatch) return new Map();
  assertCompany(candidateMatch, companyId, 'candidate-match');
  const index = new Map();
  for (const worker of list(candidateMatch.workers)) {
    assertCompany(worker, companyId, 'candidate-match-worker');
    const workerId = clean(worker.worker_id);
    if (!workerId) continue;
    index.set(workerId, {
      eligible_for_scheduling_proposal: worker.eligible_for_scheduling_proposal === true,
      blockers: uniq(worker.blockers)
    });
  }
  return index;
}

function descendants(start, reports) {
  const seen = new Set();
  const queue = [...(reports.get(start) || [])];
  while (queue.length) {
    const workerId = queue.shift();
    if (seen.has(workerId)) continue;
    seen.add(workerId);
    for (const child of reports.get(workerId) || []) queue.push(child);
  }
  return [...seen].sort();
}

export function buildManagerSupervisorTeamAssignmentHierarchy(input = {}) {
  rejectLegacyBoundary(input, 'input');
  const companyId = requireCompanyId(input.company_id);
  const graph = input.workforce_graph;
  assertGraph(graph, companyId);
  validateAcyclic(graph);

  const workers = workerIds(graph);
  const reports = directReports(graph);
  const supervision = list(input.supervision_records).map((record) =>
    normalizeSupervision(record, companyId, workers)
  );
  const teams = list(input.mission_teams).map((record) =>
    normalizeMissionTeam(record, companyId, workers)
  );
  const candidates = candidateIndex(input.candidate_match, companyId);

  const managerIds = uniq(input.manager_worker_ids);
  for (const managerId of managerIds) {
    if (!workers.has(managerId)) throw new Error('assignment-hierarchy-manager-not-in-graph');
  }

  const managerNodes = managerIds.map((managerWorkerId) => {
    const direct = [...(reports.get(managerWorkerId) || [])].sort();
    const recursive = descendants(managerWorkerId, reports);
    const supervisorWorkerIds = uniq([
      ...direct.filter((workerId) => reports.has(workerId)),
      ...supervision
        .filter((record) => recursive.includes(record.supervisor_worker_id))
        .map((record) => record.supervisor_worker_id)
    ]);
    const missionTeamIds = uniq(
      teams
        .filter((team) =>
          team.supervisor_worker_id === managerWorkerId ||
          team.coordinator_worker_id === managerWorkerId ||
          (team.supervisor_worker_id && recursive.includes(team.supervisor_worker_id)) ||
          (team.coordinator_worker_id && recursive.includes(team.coordinator_worker_id))
        )
        .map((team) => team.mission_team_id)
    );
    return {
      manager_worker_id: managerWorkerId,
      direct_report_worker_ids: direct,
      subordinate_worker_ids: recursive,
      supervisor_worker_ids: supervisorWorkerIds,
      mission_team_ids: missionTeamIds,
      manager_identity_confers_authority: false,
      grants_authority: false
    };
  });

  const teamNodes = teams.map((team) => {
    const candidateWorkers = uniq([
      ...team.member_worker_ids,
      team.coordinator_worker_id,
      team.supervisor_worker_id
    ]).map((workerId) => {
      const match = candidates.get(workerId);
      return {
        worker_id: workerId,
        eligible_for_scheduling_proposal: match?.eligible_for_scheduling_proposal === true,
        blockers: match?.blockers || (match ? [] : ['NO_CANDIDATE_MATCH_EVIDENCE'])
      };
    });
    return {
      ...team,
      candidate_workers: candidateWorkers,
      team_membership_confers_authority: false,
      supervisor_identity_confers_authority: false,
      coordinator_identity_confers_authority: false,
      grants_authority: false
    };
  });

  const unscopedCandidateWorkerIds = [...candidates.entries()]
    .filter(([workerId]) => !teams.some((team) =>
      team.member_worker_ids.includes(workerId) ||
      team.supervisor_worker_id === workerId ||
      team.coordinator_worker_id === workerId
    ))
    .map(([workerId]) => workerId)
    .sort();

  return {
    schema: SCHEMA,
    company_id: companyId,
    graph_revision: Number(graph.projection_revision || 0),
    graph_cursor: graph.projection_cursor || null,
    managers: managerNodes,
    supervisors: supervision,
    mission_teams: teamNodes,
    unscoped_candidate_worker_ids: unscopedCandidateWorkerIds,
    derived: true,
    proposal_only: true,
    hierarchy_is_coordination_not_authority: true,
    manager_identity_confers_authority: false,
    supervisor_identity_confers_authority: false,
    team_membership_confers_authority: false,
    requires_fresh_assignment_authority: true,
    automatic_assignment: false,
    automatic_reassignment: false,
    execution_permitted: false,
    grants_authority: false
  };
}

export { SCHEMA as MANAGER_SUPERVISOR_TEAM_ASSIGNMENT_HIERARCHY_SCHEMA };
