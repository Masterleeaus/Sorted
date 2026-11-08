import {
  WORKFORCE_CAPACITY_SCHEMA,
  type CapacityBudget,
  type CapacityState,
  type CapacitySubjectInput,
  type CapacitySubjectModel,
  assertCompanyId,
  rejectLegacyTenantBoundary,
} from './contracts.js';

function nonNegative(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function optionalLimit(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('capacity limit must be a non-negative number');
  return n;
}

function budget(limitValue: unknown, committedValue: unknown): CapacityBudget {
  const limit = optionalLimit(limitValue);
  const committed = nonNegative(committedValue);
  return {
    limit,
    committed,
    remaining: limit == null ? null : Math.max(0, limit - committed),
    utilization: limit == null || limit === 0 ? (limit === 0 && committed > 0 ? 1 : null) : Number((committed / limit).toFixed(4)),
  };
}

function unique(values: unknown): string[] {
  return [...new Set((Array.isArray(values) ? values : []).map((v) => String(v ?? '').trim()).filter(Boolean))].sort();
}

export function buildCapacitySubjectModel(input: CapacitySubjectInput): CapacitySubjectModel {
  rejectLegacyTenantBoundary(input as unknown as Record<string, unknown>);
  const company_id = assertCompanyId(input.company_id);
  const subject_id = String(input.subject_id ?? '').trim();
  if (!subject_id) throw new Error('subject_id is required');
  if (!['worker', 'agent', 'supervisor'].includes(input.subject_kind)) throw new Error('unsupported capacity subject kind');

  const concurrencyLimit = optionalLimit(input.concurrency_limit);
  const active = nonNegative(input.active_count);
  const queued = nonNegative(input.queued_count);
  const concurrency = budget(concurrencyLimit, active);
  const time_budget = budget(input.time_budget_minutes, input.time_committed_minutes);
  const cost_budget = budget(input.cost_budget_minor, input.cost_committed_minor);
  const blockers: string[] = [];

  if (input.enabled === false) blockers.push('DISABLED');
  if (input.healthy === false) blockers.push('UNHEALTHY');
  if (input.available === false) blockers.push('UNAVAILABLE');
  if (concurrencyLimit != null && active >= concurrencyLimit) blockers.push('CONCURRENCY_SATURATED');
  if (time_budget.limit != null && time_budget.committed >= time_budget.limit) blockers.push('TIME_BUDGET_EXHAUSTED');
  if (cost_budget.limit != null && cost_budget.committed >= cost_budget.limit) blockers.push('COST_BUDGET_EXHAUSTED');

  let state: CapacityState = 'AVAILABLE';
  if (blockers.includes('DISABLED') || blockers.includes('UNAVAILABLE')) state = 'UNAVAILABLE';
  else if (blockers.includes('UNHEALTHY')) state = 'DEGRADED';
  else if (blockers.some((x) => x.endsWith('_SATURATED') || x.endsWith('_EXHAUSTED'))) state = 'SATURATED';
  else if (queued > 0 || [concurrency.utilization, time_budget.utilization, cost_budget.utilization].some((u) => u != null && u >= 0.8)) state = 'CONSTRAINED';

  return {
    schema: WORKFORCE_CAPACITY_SCHEMA,
    company_id,
    subject_kind: input.subject_kind,
    subject_id,
    state,
    concurrency: { ...concurrency, queued },
    time_budget,
    cost_budget,
    available_for_new_work: blockers.length === 0,
    blockers,
    subordinate_ids: input.subject_kind === 'supervisor' ? unique(input.subordinate_ids) : [],
    source_refs: unique(input.source_refs),
    derived_measurement: true,
    automatic_reassignment: false,
    execution_permitted: false,
    grants_authority: false,
  };
}

export function buildCapacityPortfolio(input: { company_id: string; subjects: CapacitySubjectInput[] }) {
  rejectLegacyTenantBoundary(input as unknown as Record<string, unknown>);
  const company_id = assertCompanyId(input.company_id);
  const models = (Array.isArray(input.subjects) ? input.subjects : []).map((subject) => {
    if (subject.company_id !== company_id) throw new Error('cross-company capacity subject rejected');
    return buildCapacitySubjectModel(subject);
  });
  const counts = { worker: 0, agent: 0, supervisor: 0 };
  for (const model of models) counts[model.subject_kind] += 1;
  return {
    schema: 'titan.workforce.capacity-portfolio.v1',
    company_id,
    subjects: models,
    summary: {
      ...counts,
      total: models.length,
      available: models.filter((m) => m.available_for_new_work).length,
      constrained: models.filter((m) => m.state === 'CONSTRAINED').length,
      saturated: models.filter((m) => m.state === 'SATURATED').length,
      unavailable: models.filter((m) => m.state === 'UNAVAILABLE').length,
      degraded: models.filter((m) => m.state === 'DEGRADED').length,
      queue_depth: models.reduce((sum, m) => sum + m.concurrency.queued, 0),
    },
    recommendations_are_non_authoritative: true,
    automatic_reassignment: false,
    execution_permitted: false,
    grants_authority: false,
  } as const;
}

export function adaptWorkloadCapacitySnapshot(input: {
  company_id: string;
  snapshot: Record<string, any>;
  availability?: Array<Record<string, any>>;
}): CapacitySubjectModel[] {
  rejectLegacyTenantBoundary(input as unknown as Record<string, unknown>);
  const company_id = assertCompanyId(input.company_id);
  const snapshot = input.snapshot ?? {};
  if (snapshot.company_id !== company_id) throw new Error('cross-company workload capacity snapshot rejected');
  const availability = new Map((input.availability ?? []).map((row) => [String(row.worker_id ?? ''), row]));
  return (Array.isArray(snapshot.worker_capacity) ? snapshot.worker_capacity : []).map((row: any) => {
    const workerId = String(row.worker_id ?? '').trim();
    const availabilityRow = availability.get(workerId);
    return buildCapacitySubjectModel({
      company_id,
      subject_kind: 'worker',
      subject_id: workerId,
      enabled: true,
      healthy: row.state !== 'ERROR',
      available: availabilityRow ? String(availabilityRow.state ?? '').toUpperCase() === 'AVAILABLE' : true,
      concurrency_limit: row.capacity_units,
      active_count: row.committed_units,
      queued_count: 0,
      time_budget_minutes: row.capacity_units,
      time_committed_minutes: row.committed_units,
      source_refs: ['titan.workforce.workload-capacity.v1', availabilityRow ? 'worker-availability' : ''],
    });
  });
}
