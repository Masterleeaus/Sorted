import { LICENSED_TRADE_SERVICE_CATALOGUE, type LicensedTradeServiceDefinition } from './catalogue.js';
import type { LicensedTradeKey } from './contracts.js';

export const LICENSED_TRADES_PRICING_SCHEMA = 'titan.zero.vertical.licensed-trades.pricing.v1' as const;

export type LicensedTradePricingMode =
  | 'CALL_OUT'
  | 'DIAGNOSTIC'
  | 'HOURLY_LABOUR'
  | 'FIXED_SERVICE'
  | 'INSTALLATION'
  | 'QUOTE_REQUIRED';

export interface LicensedTradePricingInput {
  company_id: string;
  trade: LicensedTradeKey;
  service_key: string;
  requested_mode?: LicensedTradePricingMode;
  estimated_labour_minutes?: number;
  crew_size?: number;
  material_refs?: readonly string[];
  after_hours?: boolean;
  urgent?: boolean;
  travel_required?: boolean;
  unknown_scope?: boolean;
  asset_context_complete?: boolean;
  configured_policy_reference?: string | null;
}

export interface LicensedTradePricingDirective {
  readonly code: string;
  readonly kind: 'BASE' | 'SURCHARGE' | 'MATERIALS' | 'ASSUMPTION' | 'QUOTE_GATE';
  readonly source: 'licensed_trades_vertical' | 'shared_pricing_policy' | 'shared_price_book' | 'licensed_trade_catalogue';
  readonly value: string | number | boolean | readonly string[];
  readonly unit?: string;
  readonly canonical_amount_cents: null;
}

const LEGACY_BOUNDARY_KEYS = new Set(['tenant_id','tenant_company_id','tenantId','tenantCompanyId','workspace_tenant_id']);
function rejectLegacyBoundary(value: unknown, path = 'input'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((entry, index) => rejectLegacyBoundary(entry, `${path}[${index}]`));
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (LEGACY_BOUNDARY_KEYS.has(key)) throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is required`);
    rejectLegacyBoundary(nested, `${path}.${key}`);
  }
}
function requireText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}
function finitePositive(value: unknown, field: string, fallback: number): number {
  const n = value == null ? fallback : Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${field} must be greater than zero`);
  return n;
}
function list(value: readonly string[] | undefined): string[] {
  return [...new Set((value ?? []).map((entry) => String(entry).trim()).filter(Boolean))].sort();
}
function findService(trade: LicensedTradeKey, service_key: string): LicensedTradeServiceDefinition {
  const key = requireText(service_key, 'service_key');
  const service = LICENSED_TRADE_SERVICE_CATALOGUE.find((entry) => entry.service_key === key);
  if (!service) throw new Error(`unknown licensed-trade service: ${key}`);
  if (service.trade !== trade) throw new Error(`service ${key} does not belong to trade ${trade}`);
  return service;
}

function defaultMode(service: LicensedTradeServiceDefinition): LicensedTradePricingMode {
  if (service.service_class === 'EMERGENCY') return 'CALL_OUT';
  if (service.service_class === 'FAULT') return 'DIAGNOSTIC';
  if (service.service_class === 'INSTALLATION') return 'INSTALLATION';
  if (service.service_class === 'COMPLIANCE') return 'QUOTE_REQUIRED';
  return 'FIXED_SERVICE';
}

function supportedModes(service: LicensedTradeServiceDefinition): readonly LicensedTradePricingMode[] {
  const common: LicensedTradePricingMode[] = ['CALL_OUT','DIAGNOSTIC','HOURLY_LABOUR','FIXED_SERVICE','QUOTE_REQUIRED'];
  if (service.service_class === 'INSTALLATION') common.push('INSTALLATION');
  return Object.freeze([...new Set(common)]);
}

export function buildLicensedTradePricingPolicy(input: LicensedTradePricingInput) {
  rejectLegacyBoundary(input);
  const company_id = requireText(input.company_id, 'company_id');
  const service = findService(input.trade, input.service_key);
  const supported_modes = supportedModes(service);
  const mode = input.requested_mode ?? defaultMode(service);
  if (!supported_modes.includes(mode)) throw new Error(`pricing mode ${mode} is not supported for ${service.service_key}`);

  const crew_size = finitePositive(input.crew_size, 'crew_size', 1);
  if (!Number.isInteger(crew_size)) throw new Error('crew_size must be a positive integer');
  const estimated_labour_minutes = finitePositive(input.estimated_labour_minutes, 'estimated_labour_minutes', 60);
  const material_refs = Object.freeze(list(input.material_refs));
  const configured_policy_reference = String(input.configured_policy_reference ?? '').trim() || null;

  const directives: LicensedTradePricingDirective[] = [];
  directives.push({
    code: `base:${mode.toLowerCase()}`,
    kind: 'BASE',
    source: 'licensed_trades_vertical',
    value: mode,
    canonical_amount_cents: null,
  });
  directives.push({
    code: 'labour_assumption',
    kind: 'ASSUMPTION',
    source: 'licensed_trades_vertical',
    value: estimated_labour_minutes * crew_size,
    unit: 'worker_minutes',
    canonical_amount_cents: null,
  });
  if (material_refs.length) directives.push({
    code: 'materials',
    kind: 'MATERIALS',
    source: 'shared_price_book',
    value: material_refs,
    canonical_amount_cents: null,
  });
  if (input.after_hours) directives.push({ code:'after_hours',kind:'SURCHARGE',source:'shared_pricing_policy',value:true,canonical_amount_cents:null });
  if (input.urgent || service.service_class === 'EMERGENCY') directives.push({ code:'urgent_attendance',kind:'SURCHARGE',source:'shared_pricing_policy',value:true,canonical_amount_cents:null });
  if (input.travel_required) directives.push({ code:'travel',kind:'SURCHARGE',source:'shared_pricing_policy',value:true,canonical_amount_cents:null });
  if (mode === 'CALL_OUT') directives.push({ code:'call_out',kind:'BASE',source:'shared_pricing_policy',value:true,canonical_amount_cents:null });
  if (mode === 'DIAGNOSTIC') directives.push({ code:'diagnostic',kind:'BASE',source:'shared_pricing_policy',value:true,canonical_amount_cents:null });
  if (mode === 'HOURLY_LABOUR') directives.push({ code:'hourly_labour',kind:'BASE',source:'shared_pricing_policy',value:estimated_labour_minutes / 60,unit:'hours',canonical_amount_cents:null });
  if (mode === 'INSTALLATION') directives.push({ code:'installation',kind:'BASE',source:'licensed_trade_catalogue',value:service.service_key,canonical_amount_cents:null });

  const quote_reasons: string[] = [];
  if (mode === 'QUOTE_REQUIRED') quote_reasons.push('REQUESTED_MODE_REQUIRES_QUOTE');
  if (service.quote_mode !== 'QUOTE_ALLOWED') quote_reasons.push(`SERVICE_QUOTE_MODE_${service.quote_mode}`);
  if (service.risk_band === 'HIGH') quote_reasons.push('HIGH_RISK_SERVICE_REQUIRES_REVIEW');
  if (service.compliance_oriented) quote_reasons.push('COMPLIANCE_ORIENTED_SERVICE_REQUIRES_REVIEW');
  if (input.unknown_scope) quote_reasons.push('UNKNOWN_SCOPE_REQUIRES_REVIEW');
  if (input.asset_context_complete === false && service.asset_context.length) quote_reasons.push('ASSET_CONTEXT_INCOMPLETE');
  if (service.configured_policy_reference_required && !configured_policy_reference) quote_reasons.push('CONFIGURED_POLICY_REFERENCE_REQUIRED');

  const requires_quote = quote_reasons.length > 0;
  if (requires_quote) directives.push({ code:'quote_review',kind:'QUOTE_GATE',source:'licensed_trades_vertical',value:true,canonical_amount_cents:null });

  return Object.freeze({
    schema: LICENSED_TRADES_PRICING_SCHEMA,
    company_id,
    trade: input.trade,
    service_key: service.service_key,
    service_class: service.service_class,
    mode,
    supported_modes,
    crew_size,
    estimated_labour_minutes,
    material_refs,
    configured_policy_reference,
    directives: Object.freeze(directives),
    requires_quote,
    quote_reasons: Object.freeze([...new Set(quote_reasons)].sort()),
    canonical_price_cents: null,
    call_out_amount_cents: null,
    diagnostic_amount_cents: null,
    hourly_labour_rate_cents: null,
    material_amount_cents: null,
    after_hours_amount_cents: null,
    fixed_service_amount_cents: null,
    installation_amount_cents: null,
    pricing_owner: 'shared_price_book_and_pricing_settings_owner',
    quote_owner: 'shared_pricing_quote_owner',
    materials_owner: 'shared_inventory_and_price_book_owner',
    vertical_policy_is_projection: true,
    calculates_canonical_price: false,
    persists_price: false,
    issues_quote: false,
    grants_authority: false,
    execution_permitted: false,
    requires_fresh_quote_authority: true,
  });
}
