import type { CompanyBound, TitanSurface } from './contracts.js';
import { assertDistributedCompanyBoundary, normalizeTitanSurface, requireCompanyId } from './normalize.js';

export type TitanJourney = 'onboarding' | string;
export interface CanonicalDistributedContext extends CompanyBound {
  surface: TitanSurface;
  journey?: TitanJourney;
}

export interface LegacyDistributedContextInput {
  company_id?: unknown;
  tenant_company_id?: unknown;
  tenant_id?: unknown;
  tenant_company?: unknown;
  tenant?: unknown;
  tenantCompanyId?: unknown;
  organisation_id?: unknown;
  organization_id?: unknown;
  workspace_tenant_id?: unknown;
  surface?: unknown;
  app?: unknown;
  mode?: unknown;
  journey?: unknown;
}

const COMPANY_INPUT_KEYS = [
  'company_id','tenant_company_id','tenant_id','tenant_company','tenant','tenantCompanyId',
  'organisation_id','organization_id','workspace_tenant_id'
] as const;

function clean(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const out = String(value).trim();
  return out || undefined;
}

/** Boundary-only compatibility adapter. Legacy tenant keys are consumed here and never escape. */
export function normalizeDistributedContext(
  input: LegacyDistributedContextInput,
  expectedCompanyId?: string,
): CanonicalDistributedContext {
  const companyValues = COMPANY_INPUT_KEYS
    .map((key) => ({ key, value: clean(input[key]) }))
    .filter((item): item is {key: typeof COMPANY_INPUT_KEYS[number], value: string} => Boolean(item.value));
  const distinct = [...new Set(companyValues.map((item) => item.value))];
  if (distinct.length > 1) throw new Error('conflicting-company-boundary-inputs');
  const company_id = requireCompanyId({ company_id: distinct[0] }, expectedCompanyId);

  const rawSurface = input.surface ?? input.app ?? input.mode;
  const rawKey = clean(rawSurface)?.toLowerCase();
  const onboarding = rawKey === 'onboarding' || clean(input.journey)?.toLowerCase() === 'onboarding';
  const surface = normalizeTitanSurface(rawKey === 'onboarding' ? 'zero' : (onboarding && !rawSurface ? 'zero' : rawSurface));
  const context: CanonicalDistributedContext = {
    company_id,
    surface,
    ...(onboarding ? { journey: 'onboarding' } : clean(input.journey) ? { journey: clean(input.journey)! } : {}),
  };
  assertDistributedCompanyBoundary(context);
  return context;
}

/** Downstream gate: adapters must have already removed every legacy tenancy/surface alias. */
export function assertCanonicalDistributedContext(input: unknown): asserts input is CanonicalDistributedContext {
  assertDistributedCompanyBoundary(input);
  if (!input || typeof input !== 'object') throw new Error('canonical-distributed-context-required');
  const value = input as Record<string, unknown>;
  requireCompanyId({ company_id: clean(value.company_id) });
  if (value.surface !== 'zero' && value.surface !== 'go' && value.surface !== 'hub') {
    throw new Error('canonical-titan-surface-required');
  }
  for (const key of ['app','mode']) if (key in value) throw new Error(`legacy-surface-boundary:${key}`);
}

export function bindCompany<T extends object>(context: CanonicalDistributedContext, payload: T): T & CompanyBound {
  assertCanonicalDistributedContext(context);
  assertDistributedCompanyBoundary(payload);
  const existing = clean((payload as Record<string, unknown>).company_id);
  if (existing && existing !== context.company_id) throw new Error('cross-company-distributed-contract');
  return { ...payload, company_id: context.company_id };
}
