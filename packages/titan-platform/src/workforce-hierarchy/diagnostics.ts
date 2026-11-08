import { validateTitanWorkforceHierarchyStateSnapshot, type TitanWorkforceHierarchyStateSnapshot } from './state-persistence.js';

export const TITAN_WORKFORCE_HIERARCHY_DIAGNOSTICS_SCHEMA = 'titan.workforce.hierarchy-diagnostics.v1' as const;
export const TITAN_WORKFORCE_HIERARCHY_ADMIN_VIEW_SCHEMA = 'titan.workforce.hierarchy-admin-view.v1' as const;

export type TitanWorkforceHierarchyDiagnosticIssue = Readonly<{
  code: string;
  severity: 'info' | 'warning' | 'critical';
  tier: 'hierarchy' | 'manager' | 'supervisor' | 'agent' | 'worker' | 'delegation' | 'approval' | 'escalation';
  subjectId: string;
  message: string;
}>;

export type TitanWorkforceHierarchyDiagnostics = Readonly<{
  schema: typeof TITAN_WORKFORCE_HIERARCHY_DIAGNOSTICS_SCHEMA;
  companyId: string;
  revision: number;
  generatedAt: string;
  health: 'healthy' | 'attention' | 'critical';
  counts: Readonly<{
    managers: number;
    supervisors: number;
    agents: number;
    workers: number;
    delegations: number;
    openEscalations: number;
    pendingApprovals: number;
    auditEvents: number;
  }>;
  issues: readonly TitanWorkforceHierarchyDiagnosticIssue[];
  authority: Readonly<{
    identityConfersExecutionAuthority: false;
    hierarchyConfersExecutionAuthority: false;
    diagnosticsConfersExecutionAuthority: false;
    executionRequiresAuthorityEvaluation: true;
    executionRequiresCapabilityResolution: true;
    businessOpsRouteRemainsAuthoritative: true;
  }>;
}>;

export type TitanWorkforceHierarchyAdminView = Readonly<{
  schema: typeof TITAN_WORKFORCE_HIERARCHY_ADMIN_VIEW_SCHEMA;
  companyId: string;
  revision: number;
  generatedAt: string;
  summaryCards: readonly Readonly<{ key: string; label: string; value: number | string; tone: 'neutral' | 'attention' | 'critical' }>[];
  hierarchyRows: readonly Readonly<{
    tier: 'manager' | 'supervisor' | 'agent' | 'worker';
    id: string;
    parentId: string | null;
    domainId: string | null;
    state: string;
    label: string;
    executionAuthority: false;
  }>[];
  approvalRows: readonly Readonly<{ gateId: string; delegationId: string; requiredTier: string; state: string; approverId: string }>[];
  escalationRows: readonly Readonly<{ escalationId: string; delegationId: string; currentTier: string; targetTier: string; state: string; severity: string }>[];
  delegationRows: readonly Readonly<{ delegationId: string; agentKey: string; workerId: string | null; authorityCeiling: string; operation: string }>[];
  recentAudit: readonly Readonly<{ eventId: string; eventType: string; targetTier: string; targetId: string; revision: number; occurredAt: string; reason: string | null }>[];
  readOnly: true;
  executionPermitted: false;
}>;

function nowIso(value?: string) {
  const ms = Date.parse(value ?? new Date().toISOString());
  if (!Number.isFinite(ms)) throw new Error('workforce-hierarchy-diagnostics-generated-at-invalid');
  return new Date(ms).toISOString();
}

function issue(input: TitanWorkforceHierarchyDiagnosticIssue): TitanWorkforceHierarchyDiagnosticIssue {
  return Object.freeze({ ...input });
}

export function diagnoseTitanWorkforceHierarchy(
  snapshot: TitanWorkforceHierarchyStateSnapshot,
  options: { generatedAt?: string } = {},
): TitanWorkforceHierarchyDiagnostics {
  validateTitanWorkforceHierarchyStateSnapshot(snapshot);
  const issues: TitanWorkforceHierarchyDiagnosticIssue[] = [];

  for (const manager of snapshot.managerRuntimes) {
    if (manager.state !== 'active') issues.push(issue({ code: `manager_${manager.state}`, severity: manager.state === 'degraded' ? 'critical' : 'warning', tier: 'manager', subjectId: manager.managerId, message: `Manager is ${manager.state}.` }));
  }
  for (const supervisor of snapshot.supervisorRuntimes) {
    if (supervisor.state !== 'active') issues.push(issue({ code: `supervisor_${supervisor.state}`, severity: supervisor.state === 'degraded' ? 'critical' : 'warning', tier: 'supervisor', subjectId: supervisor.supervisorId, message: `Supervisor is ${supervisor.state}.` }));
  }
  for (const binding of snapshot.agentBindings) {
    if (binding.state !== 'active') issues.push(issue({ code: `agent_${binding.state}`, severity: 'warning', tier: 'agent', subjectId: binding.agentInstanceId, message: `Agent binding is ${binding.state}.` }));
  }
  for (const worker of snapshot.workers) {
    if (worker.state !== 'active') issues.push(issue({ code: `worker_${worker.state}`, severity: worker.state === 'retired' ? 'info' : 'warning', tier: 'worker', subjectId: worker.workerId, message: `Worker is ${worker.state}.` }));
  }

  const openEscalations = snapshot.escalations.filter((item) => item.state === 'open' || item.state === 'acknowledged');
  for (const escalation of openEscalations) {
    issues.push(issue({ code: 'open_escalation', severity: escalation.severity === 'critical' ? 'critical' : escalation.severity === 'high' ? 'warning' : 'info', tier: 'escalation', subjectId: escalation.escalationId, message: `Escalation ${escalation.state} at ${escalation.currentTier} tier.` }));
  }

  const pendingApprovals = snapshot.approvalGates.filter((item) => item.state === 'pending');
  for (const gate of pendingApprovals) {
    issues.push(issue({ code: 'pending_approval', severity: 'warning', tier: 'approval', subjectId: gate.gateId, message: `Approval pending at ${gate.requiredTier} tier.` }));
  }

  if (snapshot.delegations.length) {
    issues.push(issue({ code: 'in_flight_delegations', severity: 'info', tier: 'delegation', subjectId: snapshot.companyId, message: `${snapshot.delegations.length} hierarchy delegation(s) are in flight.` }));
  }

  const health: TitanWorkforceHierarchyDiagnostics['health'] = issues.some((item) => item.severity === 'critical')
    ? 'critical'
    : issues.some((item) => item.severity === 'warning')
      ? 'attention'
      : 'healthy';

  return Object.freeze({
    schema: TITAN_WORKFORCE_HIERARCHY_DIAGNOSTICS_SCHEMA,
    companyId: snapshot.companyId,
    revision: snapshot.revision,
    generatedAt: nowIso(options.generatedAt),
    health,
    counts: Object.freeze({
      managers: snapshot.managerRuntimes.length,
      supervisors: snapshot.supervisorRuntimes.length,
      agents: snapshot.agentBindings.length,
      workers: snapshot.workers.length,
      delegations: snapshot.delegations.length,
      openEscalations: openEscalations.length,
      pendingApprovals: pendingApprovals.length,
      auditEvents: snapshot.auditHistory.length,
    }),
    issues: Object.freeze([...issues].sort((a, b) => `${a.severity}:${a.code}:${a.subjectId}`.localeCompare(`${b.severity}:${b.code}:${b.subjectId}`))),
    authority: Object.freeze({
      identityConfersExecutionAuthority: false,
      hierarchyConfersExecutionAuthority: false,
      diagnosticsConfersExecutionAuthority: false,
      executionRequiresAuthorityEvaluation: true,
      executionRequiresCapabilityResolution: true,
      businessOpsRouteRemainsAuthoritative: true,
    }),
  });
}

export function createTitanWorkforceHierarchyAdminView(
  snapshot: TitanWorkforceHierarchyStateSnapshot,
  options: { generatedAt?: string; auditLimit?: number } = {},
): TitanWorkforceHierarchyAdminView {
  const diagnostics = diagnoseTitanWorkforceHierarchy(snapshot, { generatedAt: options.generatedAt });
  const hierarchyRows: TitanWorkforceHierarchyAdminView['hierarchyRows'][number][] = [];

  for (const manager of snapshot.managerRuntimes) hierarchyRows.push(Object.freeze({ tier: 'manager', id: manager.managerId, parentId: null, domainId: null, state: manager.state, label: manager.displayName ?? manager.managerId, executionAuthority: false }));
  for (const supervisor of snapshot.supervisorRuntimes) hierarchyRows.push(Object.freeze({ tier: 'supervisor', id: supervisor.supervisorId, parentId: supervisor.managerId, domainId: null, state: supervisor.state, label: supervisor.displayName ?? supervisor.supervisorId, executionAuthority: false }));
  for (const binding of snapshot.agentBindings) hierarchyRows.push(Object.freeze({ tier: 'agent', id: binding.agentInstanceId, parentId: binding.supervisorId, domainId: binding.domainId, state: binding.state, label: binding.agentKey, executionAuthority: false }));
  for (const worker of snapshot.workers) hierarchyRows.push(Object.freeze({ tier: 'worker', id: worker.workerId, parentId: worker.agentInstanceId, domainId: worker.domainId, state: worker.state, label: worker.workerName, executionAuthority: false }));

  const tone = diagnostics.health === 'critical' ? 'critical' : diagnostics.health === 'attention' ? 'attention' : 'neutral';
  const auditLimit = Math.max(1, Math.min(100, Math.trunc(options.auditLimit ?? 20)));
  const recentAudit = [...snapshot.auditHistory]
    .sort((a, b) => b.revision - a.revision || b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, auditLimit)
    .map((event) => Object.freeze({ eventId: event.eventId, eventType: event.eventType, targetTier: event.targetTier, targetId: event.targetId, revision: event.revision, occurredAt: event.occurredAt, reason: event.reason }));

  return Object.freeze({
    schema: TITAN_WORKFORCE_HIERARCHY_ADMIN_VIEW_SCHEMA,
    companyId: snapshot.companyId,
    revision: snapshot.revision,
    generatedAt: diagnostics.generatedAt,
    summaryCards: Object.freeze([
      Object.freeze({ key: 'health', label: 'Hierarchy health', value: diagnostics.health, tone }),
      Object.freeze({ key: 'agents', label: 'Agents', value: diagnostics.counts.agents, tone: 'neutral' as const }),
      Object.freeze({ key: 'workers', label: 'Workers', value: diagnostics.counts.workers, tone: 'neutral' as const }),
      Object.freeze({ key: 'delegations', label: 'In-flight delegations', value: diagnostics.counts.delegations, tone: diagnostics.counts.delegations ? 'attention' as const : 'neutral' as const }),
      Object.freeze({ key: 'approvals', label: 'Pending approvals', value: diagnostics.counts.pendingApprovals, tone: diagnostics.counts.pendingApprovals ? 'attention' as const : 'neutral' as const }),
      Object.freeze({ key: 'escalations', label: 'Open escalations', value: diagnostics.counts.openEscalations, tone: diagnostics.counts.openEscalations ? 'attention' as const : 'neutral' as const }),
      Object.freeze({ key: 'revision', label: 'Hierarchy revision', value: snapshot.revision, tone: 'neutral' as const }),
    ]),
    hierarchyRows: Object.freeze(hierarchyRows.sort((a, b) => `${a.tier}:${a.id}`.localeCompare(`${b.tier}:${b.id}`))),
    approvalRows: Object.freeze(snapshot.approvalGates.map((gate) => Object.freeze({ gateId: gate.gateId, delegationId: gate.delegationId, requiredTier: gate.requiredTier, state: gate.state, approverId: gate.requiredApproverId }))),
    escalationRows: Object.freeze(snapshot.escalations.map((item) => Object.freeze({ escalationId: item.escalationId, delegationId: item.delegationId, currentTier: item.currentTier, targetTier: item.targetTier, state: item.state, severity: item.severity }))),
    delegationRows: Object.freeze(snapshot.delegations.map((item) => Object.freeze({ delegationId: item.delegationId, agentKey: item.agentKey, workerId: item.workerId, authorityCeiling: item.authorityCeiling, operation: item.operation }))),
    recentAudit: Object.freeze(recentAudit),
    readOnly: true,
    executionPermitted: false,
  });
}
