import { LICENSED_TRADE_SERVICE_CATALOGUE } from './catalogue.js';
import type { LicensedTradeKey } from './contracts.js';

export const LICENSED_TRADES_RECURRENCE_SCHEMA = 'titan.zero.vertical.licensed-trades.recurrence.v1' as const;

export type LicensedTradeRecurrenceCadence = 'MONTHLY' | 'QUARTERLY' | 'SIX_MONTHLY' | 'ANNUAL' | 'CUSTOM';
export type LicensedTradePlanState = 'ACTIVE' | 'PAUSED' | 'CANCELLED';
export type LicensedTradePlanIntent = 'CREATE_OR_UPDATE' | 'PAUSE' | 'RESUME' | 'CHANGE' | 'REMIND' | 'REBOOK';

export interface LicensedTradeReminderPolicy {
  customer_days_before?: readonly number[];
  internal_days_before?: readonly number[];
  overdue_after_days?: number;
}

export interface LicensedTradeMaintenancePlanInput {
  company_id: string;
  trade: LicensedTradeKey;
  service_key: string;
  plan_ref: string;
  customer_ref: string;
  service_location_ref?: string | null;
  asset_refs?: readonly string[];
  cadence: LicensedTradeRecurrenceCadence;
  custom_interval_days?: number | null;
  state?: LicensedTradePlanState;
  next_due_date?: string | null;
  service_window_days?: number | null;
  reminder_policy?: LicensedTradeReminderPolicy | null;
  configured_policy_reference?: string | null;
  qualification_requirement_refs?: readonly string[];
  continuity_worker_refs?: readonly string[];
  notes_ref?: string | null;
  intent?: LicensedTradePlanIntent;
  change_reason_ref?: string | null;
}

const LEGACY_BOUNDARY_KEYS = new Set(['tenant_id','tenant_company_id','tenantId','tenantCompanyId','workspace_tenant_id','business_id','account_id','workspace_id']);
function rejectLegacyBoundary(value: unknown, path = 'input'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((entry,index)=>rejectLegacyBoundary(entry,`${path}[${index}]`));
  for (const [key,nested] of Object.entries(value as Record<string,unknown>)) {
    if (LEGACY_BOUNDARY_KEYS.has(key)) throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is required`);
    rejectLegacyBoundary(nested, `${path}.${key}`);
  }
}
function requireText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}
function optionalText(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}
function frozenList(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...new Set((values ?? []).map((v)=>String(v).trim()).filter(Boolean))].sort());
}
function isoDate(value: string | null, field: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) throw new Error(`${field} must be a valid date`);
  return value;
}
function nonNegativeInt(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${field} must be a non-negative integer`);
  return Number(value);
}
function positiveInt(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${field} must be a positive integer`);
  return Number(value);
}
function cadenceDays(cadence: LicensedTradeRecurrenceCadence, custom: number | null | undefined): number | null {
  if (cadence === 'MONTHLY') return 30;
  if (cadence === 'QUARTERLY') return 91;
  if (cadence === 'SIX_MONTHLY') return 182;
  if (cadence === 'ANNUAL') return 365;
  if (!Number.isInteger(custom) || Number(custom) <= 0) throw new Error('custom_interval_days is required for CUSTOM cadence');
  return Number(custom);
}
function normalizeReminderDays(values: readonly number[] | undefined, field: string, defaults: readonly number[]): readonly number[] {
  const source = values ?? defaults;
  const normalized = [...new Set(source.map((v)=>{
    if (!Number.isInteger(v) || v < 0 || v > 365) throw new Error(`${field} entries must be integers between 0 and 365`);
    return v;
  }))].sort((a,b)=>b-a);
  return Object.freeze(normalized);
}
function findService(trade: LicensedTradeKey, service_key: string) {
  const key = requireText(service_key,'service_key');
  const service = LICENSED_TRADE_SERVICE_CATALOGUE.find((entry)=>entry.service_key===key);
  if (!service) throw new Error(`unknown licensed-trade service: ${key}`);
  if (service.trade !== trade) throw new Error(`service ${key} does not belong to trade ${trade}`);
  return service;
}

export function buildLicensedTradeMaintenancePlan(input: LicensedTradeMaintenancePlanInput) {
  rejectLegacyBoundary(input);
  const company_id = requireText(input.company_id,'company_id');
  const service = findService(input.trade,input.service_key);
  if (!['MAINTENANCE','COMPLIANCE'].includes(service.service_class)) {
    throw new Error(`service ${service.service_key} is not recurrence-plan eligible`);
  }
  const plan_ref = requireText(input.plan_ref,'plan_ref');
  const customer_ref = requireText(input.customer_ref,'customer_ref');
  const cadence_days = cadenceDays(input.cadence,input.custom_interval_days);
  const state: LicensedTradePlanState = input.state ?? 'ACTIVE';
  if (!['ACTIVE','PAUSED','CANCELLED'].includes(state)) throw new Error(`unsupported plan state: ${state}`);
  const intent: LicensedTradePlanIntent = input.intent ?? 'CREATE_OR_UPDATE';
  if (!['CREATE_OR_UPDATE','PAUSE','RESUME','CHANGE','REMIND','REBOOK'].includes(intent)) throw new Error(`unsupported recurrence intent: ${intent}`);
  const next_due_date = isoDate(optionalText(input.next_due_date),'next_due_date');
  const service_window_days = positiveInt(input.service_window_days,'service_window_days',14);
  const policy = input.reminder_policy ?? {};
  const reminder_policy = Object.freeze({
    customer_days_before: normalizeReminderDays(policy.customer_days_before,'reminder_policy.customer_days_before',[30,7,1]),
    internal_days_before: normalizeReminderDays(policy.internal_days_before,'reminder_policy.internal_days_before',[14,3]),
    overdue_after_days: nonNegativeInt(policy.overdue_after_days,'reminder_policy.overdue_after_days',7),
  });
  const configured_policy_reference = optionalText(input.configured_policy_reference);
  const qualification_requirement_refs = frozenList(input.qualification_requirement_refs);
  const blockers: string[] = [];
  if (!next_due_date && !['PAUSE','CANCELLED'].includes(String(intent))) blockers.push('NEXT_DUE_DATE_REQUIRED');
  if (service.configured_policy_reference_required && !configured_policy_reference) blockers.push('CONFIGURED_POLICY_REFERENCE_REQUIRED');
  if (service.qualification_tags.length && qualification_requirement_refs.length === 0) blockers.push('QUALIFICATION_REQUIREMENT_REFERENCE_REQUIRED');
  if (intent === 'RESUME' && state !== 'PAUSED') blockers.push('PLAN_NOT_PAUSED');
  if (intent === 'PAUSE' && state !== 'ACTIVE') blockers.push('PLAN_NOT_ACTIVE');
  if (state === 'CANCELLED' && intent !== 'CREATE_OR_UPDATE') blockers.push('CANCELLED_PLAN_IMMUTABLE');
  if (intent === 'CHANGE' && !optionalText(input.change_reason_ref)) blockers.push('CHANGE_REASON_REFERENCE_REQUIRED');

  const target_state: LicensedTradePlanState = intent === 'PAUSE' ? 'PAUSED' : intent === 'RESUME' ? 'ACTIVE' : state;
  const uniqueBlockers = Object.freeze([...new Set(blockers)].sort());
  return Object.freeze({
    schema: LICENSED_TRADES_RECURRENCE_SCHEMA,
    company_id,
    trade: input.trade,
    service_key: service.service_key,
    service_class: service.service_class,
    plan_ref,
    customer_ref,
    service_location_ref: optionalText(input.service_location_ref),
    asset_refs: frozenList(input.asset_refs),
    cadence: input.cadence,
    cadence_days,
    custom_interval_days: input.cadence === 'CUSTOM' ? cadence_days : null,
    state,
    target_state,
    next_due_date,
    service_window_days,
    reminder_policy,
    configured_policy_reference,
    qualification_requirement_refs,
    continuity_worker_refs: frozenList(input.continuity_worker_refs),
    notes_ref: optionalText(input.notes_ref),
    intent,
    change_reason_ref: optionalText(input.change_reason_ref),
    blockers: uniqueBlockers,
    ready_for_shared_recurrence_handoff: uniqueBlockers.length === 0,
    canonical_recurrence_owner: 'shared_recurrence_rebooking_owner',
    canonical_booking_owner: 'shared_booking_owner',
    canonical_scheduling_owner: 'shared_scheduling_owner',
    canonical_assignment_owner: 'shared_workforce_assignment_owner',
    canonical_jobs_owner: 'shared_jobs_owner',
    canonical_customer_communication_owner: 'shared_customer_care_owner',
    canonical_asset_history_owner: 'shared_assets_inventory_owner',
    lifecycle_handoff: Object.freeze({
      action: intent,
      plan_ref,
      requested_target_state: target_state,
      requires_fresh_authority_evaluation: true,
      requires_canonical_commit: true,
    }),
    reminder_handoff: Object.freeze({
      next_due_date,
      customer_days_before: reminder_policy.customer_days_before,
      internal_days_before: reminder_policy.internal_days_before,
      overdue_after_days: reminder_policy.overdue_after_days,
      requires_customer_communication_owner: true,
    }),
    recurrence_projection_only: true,
    creates_or_updates_plan: false,
    creates_booking: false,
    creates_schedule: false,
    creates_job: false,
    creates_assignment: false,
    sends_reminder: false,
    mutates_asset_history: false,
    execution_permitted: false,
    grants_authority: false,
    qualification_metadata_grants_authority: false,
    continuity_preference_grants_assignment: false,
    requires_fresh_authority_evaluation: true,
  });
}
