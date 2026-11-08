import { assertCompanyId, rejectLegacyTenantBoundary } from './contracts.js';

export const WORKFORCE_SLA_SCHEMA = 'titan.workforce.sla-priority.v1' as const;

export type SlaState = 'NO_DEADLINE' | 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'PAUSED';
export type PriorityBand = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'CRITICAL';

export interface WorkforceSlaInput {
  company_id: string;
  work_id: string;
  now_ms: number;
  created_at_ms?: number | null;
  due_at_ms?: number | null;
  warning_window_ms?: number | null;
  paused?: boolean;
  blocked?: boolean;
  base_priority?: number;
  severity?: number;
  customer_impact?: number;
  risk?: number;
  dependency_criticality?: number;
  authorized_priority_override?: number | null;
  source_refs?: string[];
}

export interface WorkforceSlaPriorityModel {
  schema: typeof WORKFORCE_SLA_SCHEMA;
  company_id: string;
  work_id: string;
  sla_state: SlaState;
  deadline: {
    due_at_ms: number | null;
    now_ms: number;
    slack_ms: number | null;
    overdue_ms: number;
    warning_window_ms: number;
  };
  priority: {
    score: number;
    band: PriorityBand;
    base_priority: number;
    deadline_urgency: number;
    severity: number;
    customer_impact: number;
    risk: number;
    dependency_criticality: number;
    authorized_override: number | null;
  };
  escalation: {
    required: boolean;
    reasons: string[];
  };
  scheduling_inputs: {
    eligible_for_priority_ranking: boolean;
    priority_score: number;
    priority_band: PriorityBand;
    overdue: boolean;
    blocked: boolean;
    paused: boolean;
  };
  source_refs: string[];
  recommendation_only: true;
  automatic_assignment: false;
  automatic_reassignment: false;
  execution_permitted: false;
  grants_authority: false;
}

function bounded(value: unknown, min: number, max: number, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function optionalTimestamp(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('deadline timestamps must be non-negative finite numbers');
  return n;
}

function unique(values: unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? '').trim()).filter(Boolean))].sort();
}

function priorityBand(score: number): PriorityBand {
  if (score >= 90) return 'CRITICAL';
  if (score >= 75) return 'URGENT';
  if (score >= 55) return 'HIGH';
  if (score >= 30) return 'NORMAL';
  return 'LOW';
}

function deadlineUrgency(dueAt: number | null, now: number, warningWindow: number): number {
  if (dueAt == null) return 0;
  const slack = dueAt - now;
  if (slack <= 0) return 35;
  if (warningWindow <= 0) return 0;
  if (slack >= warningWindow) return 0;
  return Number((35 * (1 - slack / warningWindow)).toFixed(4));
}

export function buildWorkforceSlaPriority(input: WorkforceSlaInput): WorkforceSlaPriorityModel {
  rejectLegacyTenantBoundary(input as unknown as Record<string, unknown>);
  const company_id = assertCompanyId(input.company_id);
  const work_id = String(input.work_id ?? '').trim();
  if (!work_id) throw new Error('work_id is required');

  const now = optionalTimestamp(input.now_ms);
  if (now == null) throw new Error('now_ms is required');
  const dueAt = optionalTimestamp(input.due_at_ms);
  const warningWindow = bounded(input.warning_window_ms, 0, 31 * 24 * 60 * 60 * 1000, 4 * 60 * 60 * 1000);
  const paused = input.paused === true;
  const blocked = input.blocked === true;
  const slack = dueAt == null ? null : dueAt - now;
  const overdueMs = dueAt == null ? 0 : Math.max(0, now - dueAt);

  let sla_state: SlaState = 'NO_DEADLINE';
  if (paused) sla_state = 'PAUSED';
  else if (dueAt != null && overdueMs > 0) sla_state = 'BREACHED';
  else if (dueAt != null && slack != null && slack <= warningWindow) sla_state = 'AT_RISK';
  else if (dueAt != null) sla_state = 'ON_TRACK';

  const base = bounded(input.base_priority, 0, 40, 10);
  const severity = bounded(input.severity, 0, 5) * 5;
  const customerImpact = bounded(input.customer_impact, 0, 5) * 3;
  const risk = bounded(input.risk, 0, 5) * 4;
  const dependencyCriticality = bounded(input.dependency_criticality, 0, 5) * 2;
  const deadline = paused ? 0 : deadlineUrgency(dueAt, now, warningWindow);
  const override = input.authorized_priority_override == null
    ? null
    : bounded(input.authorized_priority_override, 0, 100);
  const computed = Math.min(100, base + severity + customerImpact + risk + dependencyCriticality + deadline);
  const score = override == null ? computed : Math.max(computed, override);
  const band = priorityBand(score);

  const escalationReasons: string[] = [];
  if (sla_state === 'BREACHED') escalationReasons.push('SLA_BREACHED');
  else if (sla_state === 'AT_RISK') escalationReasons.push('SLA_AT_RISK');
  if (risk >= 16) escalationReasons.push('HIGH_RISK');
  if (severity >= 20) escalationReasons.push('HIGH_SEVERITY');
  if (blocked && sla_state !== 'PAUSED') escalationReasons.push('BLOCKED_WITH_ACTIVE_SLA');

  return {
    schema: WORKFORCE_SLA_SCHEMA,
    company_id,
    work_id,
    sla_state,
    deadline: {
      due_at_ms: dueAt,
      now_ms: now,
      slack_ms: slack,
      overdue_ms: overdueMs,
      warning_window_ms: warningWindow,
    },
    priority: {
      score,
      band,
      base_priority: base,
      deadline_urgency: deadline,
      severity,
      customer_impact: customerImpact,
      risk,
      dependency_criticality: dependencyCriticality,
      authorized_override: override,
    },
    escalation: {
      required: escalationReasons.length > 0,
      reasons: escalationReasons,
    },
    scheduling_inputs: {
      eligible_for_priority_ranking: !paused,
      priority_score: score,
      priority_band: band,
      overdue: overdueMs > 0,
      blocked,
      paused,
    },
    source_refs: unique(input.source_refs),
    recommendation_only: true,
    automatic_assignment: false,
    automatic_reassignment: false,
    execution_permitted: false,
    grants_authority: false,
  };
}

export function buildWorkforceSlaQueue(input: { company_id: string; work: WorkforceSlaInput[] }) {
  rejectLegacyTenantBoundary(input as unknown as Record<string, unknown>);
  const company_id = assertCompanyId(input.company_id);
  const items = (Array.isArray(input.work) ? input.work : []).map((item) => {
    if (item.company_id !== company_id) throw new Error('cross-company SLA item rejected');
    return buildWorkforceSlaPriority(item);
  });

  return {
    schema: 'titan.workforce.sla-priority-queue.v1',
    company_id,
    items: [...items].sort((a, b) => {
      if (b.priority.score !== a.priority.score) return b.priority.score - a.priority.score;
      const aDue = a.deadline.due_at_ms ?? Number.POSITIVE_INFINITY;
      const bDue = b.deadline.due_at_ms ?? Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      return a.work_id.localeCompare(b.work_id);
    }),
    summary: {
      total: items.length,
      breached: items.filter((item) => item.sla_state === 'BREACHED').length,
      at_risk: items.filter((item) => item.sla_state === 'AT_RISK').length,
      escalation_required: items.filter((item) => item.escalation.required).length,
    },
    recommendation_only: true,
    execution_permitted: false,
    grants_authority: false,
  } as const;
}
