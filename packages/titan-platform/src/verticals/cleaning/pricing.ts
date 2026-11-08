import { CLEANING_SERVICE_BY_ID, type CleaningServiceVariant } from './catalogue.js';

export const CLEANING_PRICING_POLICY_SCHEMA = 'titan.vertical.cleaning.pricing-policy.v1' as const;

export type CleaningPricingMode = 'hourly' | 'fixed' | 'per_room' | 'per_area' | 'quote_required';
export type CleaningFrequency = 'one_off' | 'weekly' | 'fortnightly' | 'monthly' | 'custom';

export interface CleaningPricingPolicyInput {
  company_id: string;
  service_id: string;
  requested_mode?: CleaningPricingMode;
  frequency?: CleaningFrequency;
  crew_size?: number;
  estimated_minutes?: number;
  room_count?: number;
  area_m2?: number;
  travel_km?: number;
  consumables_required?: boolean;
  addon_ids?: readonly string[];
  condition_level?: 'standard' | 'heavy_soil' | 'unknown';
  urgent?: boolean;
  weekend?: boolean;
  public_holiday?: boolean;
  parking_or_tolls?: boolean;
}

export interface CleaningPricingDirective {
  code: string;
  kind: 'base' | 'minimum' | 'discount' | 'surcharge' | 'addon' | 'quote_gate' | 'assumption';
  source: string;
  value?: number | string | boolean;
  unit?: string;
  canonical_amount_cents: null;
}

const LEGACY_COMPANY_KEYS = new Set(['tenant_id','tenant_company_id','workspace_tenant_id','tenantId','tenantCompanyId']);
function rejectLegacyBoundary(value: unknown, path = 'input'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach((item, index) => rejectLegacyBoundary(item, `${path}[${index}]`)); return; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (LEGACY_COMPANY_KEYS.has(key)) throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is required`);
    rejectLegacyBoundary(child, `${path}.${key}`);
  }
}

function finiteNonNegative(value: unknown, label: string): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a finite non-negative number`);
  return n;
}

const FREQUENCY_DISCOUNT_HINTS: Readonly<Record<CleaningFrequency, number>> = Object.freeze({
  one_off: 0,
  weekly: 10,
  fortnightly: 7.5,
  monthly: 5,
  custom: 0,
});

function recommendedUnit(mode: CleaningPricingMode): string {
  switch (mode) {
    case 'hourly': return 'crew_hour';
    case 'per_room': return 'room';
    case 'per_area': return 'square_metre';
    case 'fixed': return 'service';
    case 'quote_required': return 'quote';
  }
}

function validateMode(service: CleaningServiceVariant, requested?: CleaningPricingMode): CleaningPricingMode {
  const mode = requested ?? service.default_pricing_hint;
  if (!service.pricing_hints.includes(mode)) {
    throw new Error(`pricing mode ${mode} is not supported for cleaning service ${service.id}`);
  }
  return mode;
}

function validateAddons(service: CleaningServiceVariant, addonIds: readonly string[]): void {
  const allowed = new Set(service.addons);
  const unknown = addonIds.filter(id => !allowed.has(id));
  if (unknown.length) throw new Error(`unsupported add-ons for ${service.id}: ${[...unknown].sort().join(', ')}`);
}

export function buildCleaningPricingPolicy(input: CleaningPricingPolicyInput) {
  rejectLegacyBoundary(input);
  const company_id = String(input?.company_id || '').trim();
  if (!company_id) throw new Error('company_id is required');
  const service_id = String(input?.service_id || '').trim();
  const service = CLEANING_SERVICE_BY_ID[service_id];
  if (!service) throw new Error(`unknown cleaning service id: ${service_id}`);

  const mode = validateMode(service, input.requested_mode);
  const crewSize = finiteNonNegative(input.crew_size ?? service.default_crew_size, 'crew_size')!;
  if (!Number.isInteger(crewSize) || crewSize < 1) throw new Error('crew_size must be a positive integer');
  const estimatedMinutes = finiteNonNegative(input.estimated_minutes ?? service.duration.base_minutes, 'estimated_minutes')!;
  if (estimatedMinutes <= 0) throw new Error('estimated_minutes must be greater than zero');
  const roomCount = finiteNonNegative(input.room_count, 'room_count');
  const areaM2 = finiteNonNegative(input.area_m2, 'area_m2');
  const travelKm = finiteNonNegative(input.travel_km, 'travel_km');
  const addonIds = Object.freeze([...(input.addon_ids ?? [])].map(String));
  validateAddons(service, addonIds);

  if (mode === 'per_room' && !(roomCount && roomCount > 0)) throw new Error('room_count is required for per_room pricing');
  if (mode === 'per_area' && !(areaM2 && areaM2 > 0)) throw new Error('area_m2 is required for per_area pricing');

  const frequency: CleaningFrequency = input.frequency ?? 'one_off';
  if (!Object.prototype.hasOwnProperty.call(FREQUENCY_DISCOUNT_HINTS, frequency)) throw new Error(`unsupported cleaning frequency: ${frequency}`);
  if (frequency !== 'one_off' && !service.recurring_supported) {
    throw new Error(`cleaning service ${service.id} does not support recurring-frequency pricing`);
  }

  const directives: CleaningPricingDirective[] = [];
  directives.push({
    code: `base:${mode}`,
    kind: 'base',
    source: 'cleaning_service_catalogue',
    value: mode === 'hourly' ? (estimatedMinutes / 60) * crewSize : mode === 'per_room' ? roomCount : mode === 'per_area' ? areaM2 : 1,
    unit: recommendedUnit(mode),
    canonical_amount_cents: null,
  });
  directives.push({ code:'minimum_service_fee', kind:'minimum', source:'shared_pricing_settings', value:true, canonical_amount_cents:null });
  directives.push({ code:'crew_size_assumption', kind:'assumption', source:'cleaning_vertical', value:crewSize, unit:'workers', canonical_amount_cents:null });

  const discount = FREQUENCY_DISCOUNT_HINTS[frequency];
  if (discount > 0) directives.push({ code:`frequency:${frequency}`, kind:'discount', source:'cleaning_vertical', value:discount, unit:'percent_hint', canonical_amount_cents:null });
  if ((travelKm ?? 0) > 0) directives.push({ code:'travel', kind:'surcharge', source:'shared_pricing_policy', value:travelKm, unit:'kilometres', canonical_amount_cents:null });
  if (input.consumables_required) directives.push({ code:'consumables', kind:'surcharge', source:'shared_pricing_policy', value:true, canonical_amount_cents:null });
  if (input.condition_level === 'heavy_soil') directives.push({ code:'heavy_soil', kind:'surcharge', source:'cleaning_vertical', value:true, canonical_amount_cents:null });
  if (input.condition_level === 'unknown') directives.push({ code:'condition_unknown', kind:'quote_gate', source:'cleaning_vertical', value:true, canonical_amount_cents:null });
  if (input.urgent) directives.push({ code:'urgent_booking', kind:'surcharge', source:'shared_pricing_policy', value:true, canonical_amount_cents:null });
  if (input.weekend) directives.push({ code:'weekend', kind:'surcharge', source:'shared_pricing_policy', value:true, canonical_amount_cents:null });
  if (input.public_holiday) directives.push({ code:'public_holiday', kind:'surcharge', source:'shared_pricing_policy', value:true, canonical_amount_cents:null });
  if (input.parking_or_tolls) directives.push({ code:'parking_or_tolls', kind:'surcharge', source:'shared_pricing_policy', value:true, canonical_amount_cents:null });
  for (const addon of addonIds) directives.push({ code:`addon:${addon}`, kind:'addon', source:'cleaning_service_catalogue', value:true, canonical_amount_cents:null });

  const quoteReasons: string[] = [];
  if (service.quote_required || mode === 'quote_required') quoteReasons.push('SERVICE_OR_MODE_REQUIRES_QUOTE');
  if (input.condition_level === 'unknown') quoteReasons.push('CONDITION_REQUIRES_REVIEW');
  if (service.risk_level === 'HIGH') quoteReasons.push('HIGH_RISK_SERVICE_REQUIRES_REVIEW');
  if (estimatedMinutes > service.duration.max_minutes) quoteReasons.push('DURATION_EXCEEDS_CATALOGUE_ASSUMPTION');
  if (crewSize > Math.max(service.default_crew_size * 2, 4)) quoteReasons.push('CREW_SIZE_OUTSIDE_STANDARD_ASSUMPTION');

  const requiresQuote = quoteReasons.length > 0;
  if (requiresQuote && !directives.some(d => d.kind === 'quote_gate')) {
    directives.push({ code:'quote_review', kind:'quote_gate', source:'cleaning_vertical', value:true, canonical_amount_cents:null });
  }

  return Object.freeze({
    schema: CLEANING_PRICING_POLICY_SCHEMA,
    company_id,
    service_id: service.id,
    mode,
    unit: recommendedUnit(mode),
    frequency,
    crew_size: crewSize,
    estimated_minutes: estimatedMinutes,
    directives: Object.freeze(directives),
    requires_quote: requiresQuote,
    quote_reasons: Object.freeze([...new Set(quoteReasons)].sort()),
    canonical_price_cents: null,
    pricing_owner: 'shared_pricing_price_book_and_settings',
    quote_owner: 'shared_customer_quote_flow',
    policy_is_projection: true,
    persists_price: false,
    calculates_canonical_price: false,
    grants_authority: false,
    execution_permitted: false,
  });
}
