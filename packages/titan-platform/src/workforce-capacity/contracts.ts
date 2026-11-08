export const WORKFORCE_CAPACITY_SCHEMA = 'titan.workforce.capacity-model.v1' as const;

export type CapacitySubjectKind = 'worker' | 'agent' | 'supervisor';
export type CapacityState = 'AVAILABLE' | 'CONSTRAINED' | 'SATURATED' | 'UNAVAILABLE' | 'DEGRADED';

export interface CapacityBudget {
  limit: number | null;
  committed: number;
  remaining: number | null;
  utilization: number | null;
}

export interface CapacitySubjectInput {
  company_id: string;
  subject_kind: CapacitySubjectKind;
  subject_id: string;
  enabled?: boolean;
  healthy?: boolean;
  available?: boolean;
  concurrency_limit?: number | null;
  active_count?: number;
  queued_count?: number;
  time_budget_minutes?: number | null;
  time_committed_minutes?: number;
  cost_budget_minor?: number | null;
  cost_committed_minor?: number;
  subordinate_ids?: string[];
  source_refs?: string[];
}

export interface CapacitySubjectModel {
  schema: typeof WORKFORCE_CAPACITY_SCHEMA;
  company_id: string;
  subject_kind: CapacitySubjectKind;
  subject_id: string;
  state: CapacityState;
  concurrency: CapacityBudget & { queued: number };
  time_budget: CapacityBudget;
  cost_budget: CapacityBudget;
  available_for_new_work: boolean;
  blockers: string[];
  subordinate_ids: string[];
  source_refs: string[];
  derived_measurement: true;
  automatic_reassignment: false;
  execution_permitted: false;
  grants_authority: false;
}

export function assertCompanyId(value: unknown, label = 'input'): string {
  const companyId = String(value ?? '').trim();
  if (!/^[A-Za-z0-9._:-]{2,128}$/.test(companyId)) throw new Error(`${label}.company_id is required`);
  return companyId;
}

export function rejectLegacyTenantBoundary(value: Record<string, unknown> | null | undefined): void {
  if (!value) return;
  if (Object.hasOwn(value, 'tenant_id') || Object.hasOwn(value, 'tenant_company_id')) {
    throw new Error('legacy tenant boundary is not permitted; use company_id only');
  }
}
