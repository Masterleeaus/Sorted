import { assertCompanyId, rejectLegacyTenantBoundary, type CapacitySubjectModel } from './contracts.js';

export const WORKFORCE_BACKPRESSURE_SCHEMA = 'titan.workforce.capacity-backpressure.v1' as const;

export type WorkforceOperatingMode = 'ONLINE' | 'DEGRADED' | 'OFFLINE';
export type IntakeRecommendation = 'ACCEPT' | 'THROTTLE' | 'DEFER' | 'REVIEW';

export interface WorkforceBackpressurePolicy {
  constrained_intake_fraction?: number;
  degraded_intake_fraction?: number;
  queue_warning_depth?: number;
  queue_hard_limit?: number;
}

export interface WorkforceBackpressureInput {
  company_id: string;
  operating_mode?: WorkforceOperatingMode;
  subjects: CapacitySubjectModel[];
  policy?: WorkforceBackpressurePolicy;
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function nonNegativeInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function maxUtilization(subject: CapacitySubjectModel): number {
  const values = [subject.concurrency.utilization, subject.time_budget.utilization, subject.cost_budget.utilization]
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (!values.length) return subject.state === 'AVAILABLE' ? 0 : subject.state === 'CONSTRAINED' ? 0.8 : 1;
  return Math.max(...values);
}

export function buildWorkforceBackpressurePlan(input: WorkforceBackpressureInput) {
  rejectLegacyTenantBoundary(input as unknown as Record<string, unknown>);
  const company_id = assertCompanyId(input.company_id);
  const operating_mode: WorkforceOperatingMode = input.operating_mode ?? 'ONLINE';
  if (!['ONLINE', 'DEGRADED', 'OFFLINE'].includes(operating_mode)) throw new Error('unsupported workforce operating mode');

  const constrainedFraction = bounded(input.policy?.constrained_intake_fraction, 0, 1, 0.5);
  const degradedFraction = bounded(input.policy?.degraded_intake_fraction, 0, 1, 0.25);
  const queueWarningDepth = nonNegativeInt(input.policy?.queue_warning_depth, 3);
  const queueHardLimit = Math.max(queueWarningDepth, nonNegativeInt(input.policy?.queue_hard_limit, 10));

  const subjects = (Array.isArray(input.subjects) ? input.subjects : []).map((subject) => {
    if (subject.company_id !== company_id) throw new Error('cross-company backpressure subject rejected');
    return subject;
  });

  const decisions = subjects
    .map((subject) => {
      const reasons: string[] = [...subject.blockers];
      const queueDepth = subject.concurrency.queued;
      const utilization = maxUtilization(subject);
      let intake_fraction = 1;
      let recommendation: IntakeRecommendation = 'ACCEPT';
      let requires_reconnect_review = false;

      if (operating_mode === 'OFFLINE') {
        reasons.push('WORKFORCE_OFFLINE');
        recommendation = 'DEFER';
        intake_fraction = 0;
        requires_reconnect_review = true;
      } else if (subject.state === 'UNAVAILABLE' || subject.state === 'SATURATED') {
        reasons.push(subject.state === 'UNAVAILABLE' ? 'SUBJECT_UNAVAILABLE' : 'SUBJECT_SATURATED');
        recommendation = 'DEFER';
        intake_fraction = 0;
      } else if (queueDepth >= queueHardLimit) {
        reasons.push('QUEUE_HARD_LIMIT');
        recommendation = 'DEFER';
        intake_fraction = 0;
      } else if (operating_mode === 'DEGRADED' || subject.state === 'DEGRADED') {
        reasons.push(operating_mode === 'DEGRADED' ? 'WORKFORCE_DEGRADED' : 'SUBJECT_DEGRADED');
        recommendation = 'THROTTLE';
        intake_fraction = degradedFraction;
      } else if (subject.state === 'CONSTRAINED' || queueDepth >= queueWarningDepth || utilization >= 0.8) {
        if (queueDepth >= queueWarningDepth) reasons.push('QUEUE_PRESSURE');
        if (utilization >= 0.8) reasons.push('HIGH_UTILIZATION');
        recommendation = 'THROTTLE';
        intake_fraction = constrainedFraction;
      }

      return {
        company_id,
        subject_kind: subject.subject_kind,
        subject_id: subject.subject_id,
        capacity_state: subject.state,
        operating_mode,
        queue_depth: queueDepth,
        max_utilization: Number(utilization.toFixed(4)),
        recommendation,
        recommended_intake_fraction: Number(intake_fraction.toFixed(4)),
        reasons: unique(reasons),
        requires_reconnect_review,
        preserve_pending_work: true,
        drop_pending_work: false,
        blind_retry_permitted: false,
        automatic_execution: false,
        automatic_assignment: false,
        automatic_reassignment: false,
        execution_permitted: false,
        grants_authority: false,
      } as const;
    })
    .sort((a, b) => {
      const rank: Record<IntakeRecommendation, number> = { DEFER: 0, REVIEW: 1, THROTTLE: 2, ACCEPT: 3 };
      if (rank[a.recommendation] !== rank[b.recommendation]) return rank[a.recommendation] - rank[b.recommendation];
      if (a.queue_depth !== b.queue_depth) return b.queue_depth - a.queue_depth;
      return `${a.subject_kind}:${a.subject_id}`.localeCompare(`${b.subject_kind}:${b.subject_id}`);
    });

  const totalQueue = decisions.reduce((sum, decision) => sum + decision.queue_depth, 0);
  const held = decisions.filter((decision) => decision.recommendation === 'DEFER').length;
  const throttled = decisions.filter((decision) => decision.recommendation === 'THROTTLE').length;

  return {
    schema: WORKFORCE_BACKPRESSURE_SCHEMA,
    company_id,
    operating_mode,
    policy: {
      constrained_intake_fraction: constrainedFraction,
      degraded_intake_fraction: degradedFraction,
      queue_warning_depth: queueWarningDepth,
      queue_hard_limit: queueHardLimit,
    },
    decisions,
    summary: {
      subjects: decisions.length,
      queue_depth: totalQueue,
      held,
      throttled,
      accepting: decisions.filter((decision) => decision.recommendation === 'ACCEPT').length,
      overload_present: held > 0 || throttled > 0,
    },
    projection_only: true,
    creates_parallel_queue: false,
    preserves_pending_work: true,
    automatic_retry: false,
    automatic_execution: false,
    automatic_assignment: false,
    automatic_reassignment: false,
    execution_permitted: false,
    grants_authority: false,
  } as const;
}
