import { assertCompanyId, rejectLegacyTenantBoundary, type CapacitySubjectKind, type CapacitySubjectModel } from './contracts.js';

export const WORKFORCE_BALANCING_SCHEMA = 'titan.workforce.supervisor-balancing.v1' as const;

export interface BalanceWorkItem {
  company_id: string;
  work_id: string;
  assigned_subject_kind: Exclude<CapacitySubjectKind, 'supervisor'>;
  assigned_subject_id: string;
  priority_score?: number;
  due_at_ms?: number | null;
  source_refs?: string[];
}

export interface SupervisorBalancingInput {
  company_id: string;
  supervisor: CapacitySubjectModel;
  subjects: CapacitySubjectModel[];
  work: BalanceWorkItem[];
  quality_scores?: Record<string, number | null | undefined>;
  max_proposals?: number;
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function unique(values: unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map((v) => String(v ?? '').trim()).filter(Boolean))].sort();
}

function utilization(model: CapacitySubjectModel): number {
  const values = [model.concurrency.utilization, model.time_budget.utilization, model.cost_budget.utilization]
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (!values.length) return model.state === 'AVAILABLE' ? 0 : model.state === 'CONSTRAINED' ? 0.75 : 1;
  return Math.max(...values);
}

function qualityScore(subjectId: string, scores: Record<string, number | null | undefined>): number {
  const n = Number(scores[subjectId]);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}

function subjectKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function eligibleTarget(model: CapacitySubjectModel): boolean {
  return model.subject_kind !== 'supervisor'
    && model.available_for_new_work
    && model.state !== 'SATURATED'
    && model.state !== 'UNAVAILABLE'
    && model.state !== 'DEGRADED';
}

function needsRelief(model: CapacitySubjectModel): boolean {
  return model.state === 'SATURATED'
    || model.state === 'UNAVAILABLE'
    || model.state === 'DEGRADED'
    || model.concurrency.queued > 0;
}

export function buildSupervisorBalancingPlan(input: SupervisorBalancingInput) {
  rejectLegacyTenantBoundary(input as unknown as Record<string, unknown>);
  const company_id = assertCompanyId(input.company_id);
  const supervisor = input.supervisor;
  if (supervisor.company_id !== company_id) throw new Error('cross-company supervisor rejected');
  if (supervisor.subject_kind !== 'supervisor') throw new Error('supervisor capacity model required');

  const scope = new Set(unique(supervisor.subordinate_ids));
  const subjects = (Array.isArray(input.subjects) ? input.subjects : []).map((subject) => {
    if (subject.company_id !== company_id) throw new Error('cross-company balancing subject rejected');
    return subject;
  });
  const subjectMap = new Map(subjects.map((subject) => [subjectKey(subject.subject_kind, subject.subject_id), subject]));
  const quality_scores = input.quality_scores ?? {};
  const max_proposals = Math.floor(bounded(input.max_proposals, 0, 25, 5));

  const proposals: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];

  const work = [...(Array.isArray(input.work) ? input.work : [])].sort((a, b) => {
    const priorityDelta = bounded(b.priority_score, 0, 100, 0) - bounded(a.priority_score, 0, 100, 0);
    if (priorityDelta !== 0) return priorityDelta;
    const aDue = a.due_at_ms == null ? Number.POSITIVE_INFINITY : Number(a.due_at_ms);
    const bDue = b.due_at_ms == null ? Number.POSITIVE_INFINITY : Number(b.due_at_ms);
    if (aDue !== bDue) return aDue - bDue;
    return String(a.work_id).localeCompare(String(b.work_id));
  });

  for (const item of work) {
    if (proposals.length >= max_proposals) break;
    rejectLegacyTenantBoundary(item as unknown as Record<string, unknown>);
    if (item.company_id !== company_id) throw new Error('cross-company balancing work rejected');
    const work_id = String(item.work_id ?? '').trim();
    if (!work_id) throw new Error('work_id is required');
    const source = subjectMap.get(subjectKey(item.assigned_subject_kind, item.assigned_subject_id));
    if (!source) {
      skipped.push({ work_id, reason: 'ASSIGNED_SUBJECT_NOT_FOUND' });
      continue;
    }
    if (scope.size && !scope.has(source.subject_id)) {
      skipped.push({ work_id, reason: 'SOURCE_OUTSIDE_SUPERVISOR_SCOPE' });
      continue;
    }
    if (!needsRelief(source)) {
      skipped.push({ work_id, reason: 'SOURCE_DOES_NOT_REQUIRE_RELIEF' });
      continue;
    }

    const sourceUtilization = utilization(source);
    const candidates = subjects
      .filter((candidate) => candidate.subject_kind === item.assigned_subject_kind)
      .filter((candidate) => candidate.subject_id !== source.subject_id)
      .filter((candidate) => !scope.size || scope.has(candidate.subject_id))
      .filter(eligibleTarget)
      .map((candidate) => ({
        candidate,
        utilization: utilization(candidate),
        quality: qualityScore(candidate.subject_id, quality_scores),
      }))
      .filter(({ utilization: candidateUtilization }) => candidateUtilization < sourceUtilization)
      .sort((a, b) => {
        if (a.utilization !== b.utilization) return a.utilization - b.utilization;
        if (a.quality !== b.quality) return b.quality - a.quality;
        return a.candidate.subject_id.localeCompare(b.candidate.subject_id);
      });

    const target = candidates[0];
    if (!target) {
      skipped.push({ work_id, reason: 'NO_ELIGIBLE_LOWER_LOAD_TARGET' });
      continue;
    }

    const reasons = [...source.blockers];
    if (source.concurrency.queued > 0) reasons.push('QUEUE_PRESSURE');
    proposals.push({
      proposal_id: `balance:${work_id}:${source.subject_id}->${target.candidate.subject_id}`,
      company_id,
      supervisor_id: supervisor.subject_id,
      work_id,
      subject_kind: item.assigned_subject_kind,
      from_subject_id: source.subject_id,
      to_subject_id: target.candidate.subject_id,
      source_state: source.state,
      source_utilization: Number(sourceUtilization.toFixed(4)),
      target_state: target.candidate.state,
      target_utilization: Number(target.utilization.toFixed(4)),
      target_quality_score: target.quality,
      reasons: unique(reasons),
      source_refs: unique(item.source_refs),
      requires_approval: true,
      requires_fresh_authority_evaluation: true,
      proposal_only: true,
      automatic_assignment: false,
      automatic_reassignment: false,
      execution_permitted: false,
      grants_authority: false,
    });
  }

  return {
    schema: WORKFORCE_BALANCING_SCHEMA,
    company_id,
    supervisor_id: supervisor.subject_id,
    supervisor_scope: [...scope].sort(),
    proposals,
    skipped,
    summary: {
      work_considered: work.length,
      proposals: proposals.length,
      skipped: skipped.length,
      proposal_limit: max_proposals,
    },
    bounded_reassignment_recommendations: true,
    requires_approval: true,
    automatic_assignment: false,
    automatic_reassignment: false,
    execution_permitted: false,
    grants_authority: false,
  } as const;
}
