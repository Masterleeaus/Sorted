import { assertCompanyId, rejectLegacyTenantBoundary, type CapacitySubjectModel } from './contracts.js';
import type { WorkforceSlaPriorityModel } from './sla.js';

export const WORKFORCE_CAPACITY_DIAGNOSTICS_SCHEMA = 'titan.workforce.capacity-diagnostics.v1' as const;

export type DiagnosticsViewerRole = 'manager' | 'supervisor';
export type DiagnosticSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface WorkforceDiagnosticsInput {
  company_id: string;
  viewer: {
    role: DiagnosticsViewerRole;
    supervisor_id?: string | null;
    subordinate_ids?: string[];
  };
  capacity?: CapacitySubjectModel[];
  sla?: WorkforceSlaPriorityModel[];
  quality?: Array<Record<string, any>>;
  backpressure?: Array<Record<string, any>>;
  feedback?: Array<Record<string, any>>;
  work_owner_map?: Record<string, string>;
}

function unique(values: unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))].sort();
}

function assertScopedCompany(companyId: string, row: Record<string, any>, label: string): void {
  rejectLegacyTenantBoundary(row as Record<string, unknown>);
  if (String(row.company_id ?? '') !== companyId) throw new Error(`cross-company ${label} rejected`);
}

function severityRank(value: DiagnosticSeverity): number {
  return value === 'CRITICAL' ? 3 : value === 'WARNING' ? 2 : 1;
}

function alert(input: {
  severity: DiagnosticSeverity;
  code: string;
  subject_kind: string;
  subject_id: string;
  detail: string;
  source_refs?: string[];
}) {
  return {
    severity: input.severity,
    code: input.code,
    subject_kind: input.subject_kind,
    subject_id: input.subject_id,
    detail: input.detail,
    source_refs: unique(input.source_refs),
    recommendation_only: true,
    mutation_permitted: false,
    grants_authority: false,
  } as const;
}

export function buildWorkforceCapacityDiagnostics(input: WorkforceDiagnosticsInput) {
  rejectLegacyTenantBoundary(input as unknown as Record<string, unknown>);
  const company_id = assertCompanyId(input.company_id);
  if (!['manager', 'supervisor'].includes(input.viewer?.role)) throw new Error('unsupported diagnostics viewer role');

  const supervisorId = String(input.viewer.supervisor_id ?? '').trim();
  const subordinateIds = unique(input.viewer.subordinate_ids);
  if (input.viewer.role === 'supervisor' && !supervisorId) throw new Error('supervisor_id is required for supervisor diagnostics');

  const permittedSubjects = new Set(input.viewer.role === 'manager' ? [] : [supervisorId, ...subordinateIds]);
  const canViewSubject = (subjectId: string) => input.viewer.role === 'manager' || permittedSubjects.has(subjectId);

  const capacity = (input.capacity ?? []).map((row) => {
    assertScopedCompany(company_id, row as unknown as Record<string, any>, 'capacity diagnostic');
    return row;
  }).filter((row) => canViewSubject(row.subject_id));

  const quality = (input.quality ?? []).map((row) => {
    assertScopedCompany(company_id, row, 'quality diagnostic');
    return row;
  }).filter((row) => canViewSubject(String(row.subject_id ?? '')));

  const feedback = (input.feedback ?? []).map((row) => {
    assertScopedCompany(company_id, row, 'feedback diagnostic');
    return row;
  }).filter((row) => canViewSubject(String(row.subject_id ?? '')));

  const backpressure = (input.backpressure ?? []).map((row) => {
    assertScopedCompany(company_id, row, 'backpressure diagnostic');
    return row;
  }).filter((row) => canViewSubject(String(row.subject_id ?? '')));

  const sla = (input.sla ?? []).map((row) => {
    assertScopedCompany(company_id, row as unknown as Record<string, any>, 'SLA diagnostic');
    return row;
  }).filter((row) => {
    if (input.viewer.role === 'manager') return true;
    const owner = String(input.work_owner_map?.[row.work_id] ?? '').trim();
    return owner !== '' && permittedSubjects.has(owner);
  });

  const alerts: ReturnType<typeof alert>[] = [];
  for (const row of capacity) {
    if (row.state === 'SATURATED' || row.state === 'UNAVAILABLE') {
      alerts.push(alert({ severity: 'CRITICAL', code: `CAPACITY_${row.state}`, subject_kind: row.subject_kind, subject_id: row.subject_id, detail: row.blockers.join(', ') || row.state, source_refs: row.source_refs }));
    } else if (row.state === 'CONSTRAINED' || row.state === 'DEGRADED') {
      alerts.push(alert({ severity: 'WARNING', code: `CAPACITY_${row.state}`, subject_kind: row.subject_kind, subject_id: row.subject_id, detail: row.blockers.join(', ') || row.state, source_refs: row.source_refs }));
    }
  }
  for (const row of sla) {
    if (row.sla_state === 'BREACHED') alerts.push(alert({ severity: 'CRITICAL', code: 'SLA_BREACHED', subject_kind: 'work', subject_id: row.work_id, detail: `${row.deadline.overdue_ms}ms overdue`, source_refs: row.source_refs }));
    else if (row.sla_state === 'AT_RISK' || row.escalation.required) alerts.push(alert({ severity: 'WARNING', code: row.sla_state === 'AT_RISK' ? 'SLA_AT_RISK' : 'SLA_ESCALATION', subject_kind: 'work', subject_id: row.work_id, detail: row.escalation.reasons.join(', ') || row.sla_state, source_refs: row.source_refs }));
  }
  for (const row of quality) {
    const state = String(row.state ?? '');
    if (state === 'POOR') alerts.push(alert({ severity: 'CRITICAL', code: 'QUALITY_POOR', subject_kind: 'subject', subject_id: String(row.subject_id ?? ''), detail: unique(row.review_reasons).join(', ') || 'quality review required', source_refs: row.source_refs }));
    else if (state === 'REVIEW' || row.review_required === true) alerts.push(alert({ severity: 'WARNING', code: 'QUALITY_REVIEW', subject_kind: 'subject', subject_id: String(row.subject_id ?? ''), detail: unique(row.review_reasons).join(', ') || 'quality review required', source_refs: row.source_refs }));
  }
  for (const row of backpressure) {
    const recommendation = String(row.recommendation ?? '');
    if (recommendation === 'DEFER') alerts.push(alert({ severity: 'CRITICAL', code: 'BACKPRESSURE_DEFER', subject_kind: String(row.subject_kind ?? 'subject'), subject_id: String(row.subject_id ?? ''), detail: unique(row.reasons).join(', ') || 'intake deferred', source_refs: row.source_refs }));
    else if (recommendation === 'THROTTLE') alerts.push(alert({ severity: 'WARNING', code: 'BACKPRESSURE_THROTTLE', subject_kind: String(row.subject_kind ?? 'subject'), subject_id: String(row.subject_id ?? ''), detail: unique(row.reasons).join(', ') || 'intake throttled', source_refs: row.source_refs }));
  }

  alerts.sort((a, b) => {
    const severity = severityRank(b.severity) - severityRank(a.severity);
    if (severity !== 0) return severity;
    if (a.code !== b.code) return a.code.localeCompare(b.code);
    return `${a.subject_kind}:${a.subject_id}`.localeCompare(`${b.subject_kind}:${b.subject_id}`);
  });

  const capacityCounts = {
    total: capacity.length,
    available: capacity.filter((row) => row.state === 'AVAILABLE').length,
    constrained: capacity.filter((row) => row.state === 'CONSTRAINED').length,
    saturated: capacity.filter((row) => row.state === 'SATURATED').length,
    unavailable: capacity.filter((row) => row.state === 'UNAVAILABLE').length,
    degraded: capacity.filter((row) => row.state === 'DEGRADED').length,
    queue_depth: capacity.reduce((sum, row) => sum + row.concurrency.queued, 0),
  };

  return {
    schema: WORKFORCE_CAPACITY_DIAGNOSTICS_SCHEMA,
    company_id,
    viewer: {
      role: input.viewer.role,
      supervisor_id: input.viewer.role === 'supervisor' ? supervisorId : null,
      scoped_subject_ids: input.viewer.role === 'supervisor' ? [...permittedSubjects].sort() : null,
    },
    summary: {
      capacity: capacityCounts,
      sla: {
        total: sla.length,
        breached: sla.filter((row) => row.sla_state === 'BREACHED').length,
        at_risk: sla.filter((row) => row.sla_state === 'AT_RISK').length,
        escalation_required: sla.filter((row) => row.escalation.required).length,
      },
      quality: {
        total: quality.length,
        poor: quality.filter((row) => row.state === 'POOR').length,
        review: quality.filter((row) => row.state === 'REVIEW' || row.review_required === true).length,
      },
      backpressure: {
        total: backpressure.length,
        deferred: backpressure.filter((row) => row.recommendation === 'DEFER').length,
        throttled: backpressure.filter((row) => row.recommendation === 'THROTTLE').length,
      },
      feedback: {
        total: feedback.length,
        positive: feedback.filter((row) => Number(row.routing_adjustment ?? 0) > 0).length,
        negative: feedback.filter((row) => Number(row.routing_adjustment ?? 0) < 0).length,
      },
      critical_alerts: alerts.filter((row) => row.severity === 'CRITICAL').length,
      warning_alerts: alerts.filter((row) => row.severity === 'WARNING').length,
    },
    sections: {
      capacity,
      sla,
      quality,
      backpressure,
      feedback,
      alerts,
    },
    inspection_surface: input.viewer.role === 'manager' ? 'MANAGER' : 'SUPERVISOR',
    read_only: true,
    business_truth_source_unchanged: true,
    duplicates_observability: false,
    mutation_permitted: false,
    automatic_assignment: false,
    automatic_reassignment: false,
    execution_permitted: false,
    grants_authority: false,
  } as const;
}
