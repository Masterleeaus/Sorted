import { LICENSED_TRADE_SERVICE_CATALOGUE } from './catalogue.js';
import type { LicensedTradeKey } from './contracts.js';

export const LICENSED_TRADES_ASSET_CONTEXT_SCHEMA = 'titan.zero.vertical.licensed-trades.asset-context.v1' as const;

export type LicensedTradeAssetKind =
  | 'HOT_WATER_SYSTEM'
  | 'PLUMBING_FIXTURE'
  | 'PUMP_OR_PRESSURE_SYSTEM'
  | 'SWITCHBOARD'
  | 'ELECTRICAL_CIRCUIT'
  | 'ELECTRICAL_EQUIPMENT'
  | 'HVAC_UNIT'
  | 'HVAC_CONTROL'
  | 'OTHER_CONFIGURED_ASSET';

export interface LicensedTradeServiceHistoryEntry {
  history_ref: string;
  service_date?: string | null;
  summary?: string | null;
  job_ref?: string | null;
  evidence_refs?: readonly string[];
}

export interface LicensedTradeAssetContextInput {
  company_id: string;
  trade: LicensedTradeKey;
  service_key: string;
  asset_ref?: string | null;
  asset_kind: LicensedTradeAssetKind;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  site_location?: string | null;
  installation_date?: string | null;
  condition_reference?: string | null;
  service_history?: readonly LicensedTradeServiceHistoryEntry[];
  configured_asset_policy_reference?: string | null;
}

const LEGACY_BOUNDARY_KEYS = new Set(['tenant_id','tenant_company_id','tenantId','tenantCompanyId','workspace_tenant_id','business_id','account_id','workspace_id']);
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
function optionalText(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}
function validateIsoDate(value: string | null, field: string): string | null {
  if (!value) return null;
  if (Number.isNaN(Date.parse(value))) throw new Error(`${field} must be an ISO date/date-time`);
  return value;
}
function frozenList(value: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...new Set((value ?? []).map((entry) => String(entry).trim()).filter(Boolean))].sort());
}

const TRADE_ASSET_KINDS = Object.freeze({
  plumbing: Object.freeze(['HOT_WATER_SYSTEM','PLUMBING_FIXTURE','PUMP_OR_PRESSURE_SYSTEM','OTHER_CONFIGURED_ASSET'] as const),
  electrical: Object.freeze(['SWITCHBOARD','ELECTRICAL_CIRCUIT','ELECTRICAL_EQUIPMENT','OTHER_CONFIGURED_ASSET'] as const),
  hvac: Object.freeze(['HVAC_UNIT','HVAC_CONTROL','OTHER_CONFIGURED_ASSET'] as const),
}) satisfies Readonly<Record<LicensedTradeKey, readonly LicensedTradeAssetKind[]>>;

function findService(trade: LicensedTradeKey, service_key: string) {
  const key = requireText(service_key, 'service_key');
  const service = LICENSED_TRADE_SERVICE_CATALOGUE.find((entry) => entry.service_key === key);
  if (!service) throw new Error(`unknown licensed-trade service: ${key}`);
  if (service.trade !== trade) throw new Error(`service ${key} does not belong to trade ${trade}`);
  return service;
}

function normalizeHistory(entry: LicensedTradeServiceHistoryEntry, index: number) {
  rejectLegacyBoundary(entry, `service_history[${index}]`);
  const history_ref = requireText(entry.history_ref, `service_history[${index}].history_ref`);
  const service_date = validateIsoDate(optionalText(entry.service_date), `service_history[${index}].service_date`);
  return Object.freeze({
    history_ref,
    service_date,
    summary: optionalText(entry.summary),
    job_ref: optionalText(entry.job_ref),
    evidence_refs: frozenList(entry.evidence_refs),
  });
}

export function buildLicensedTradeAssetContext(input: LicensedTradeAssetContextInput) {
  rejectLegacyBoundary(input);
  const company_id = requireText(input.company_id, 'company_id');
  const service = findService(input.trade, input.service_key);
  const allowedAssetKinds: readonly LicensedTradeAssetKind[] = TRADE_ASSET_KINDS[input.trade];
  if (!allowedAssetKinds.includes(input.asset_kind)) {
    throw new Error(`asset kind ${input.asset_kind} is not valid for trade ${input.trade}`);
  }

  const asset_ref = optionalText(input.asset_ref);
  const manufacturer = optionalText(input.manufacturer);
  const model = optionalText(input.model);
  const serial_number = optionalText(input.serial_number);
  const site_location = optionalText(input.site_location);
  const installation_date = validateIsoDate(optionalText(input.installation_date), 'installation_date');
  const condition_reference = optionalText(input.condition_reference);
  const configured_asset_policy_reference = optionalText(input.configured_asset_policy_reference);
  const service_history = Object.freeze((input.service_history ?? []).map(normalizeHistory));

  const readiness_gaps: string[] = [];
  if (!asset_ref) readiness_gaps.push('ASSET_REFERENCE_MISSING');
  if (!site_location) readiness_gaps.push('SITE_LOCATION_MISSING');
  if (!model) readiness_gaps.push('MODEL_MISSING');
  if (!serial_number) readiness_gaps.push('SERIAL_NUMBER_MISSING');
  if (service.asset_context.length && !configured_asset_policy_reference) readiness_gaps.push('CONFIGURED_ASSET_POLICY_REFERENCE_MISSING');

  const identity = Object.freeze({ manufacturer, model, serial_number });

  return Object.freeze({
    schema: LICENSED_TRADES_ASSET_CONTEXT_SCHEMA,
    company_id,
    trade: input.trade,
    service_key: service.service_key,
    asset_kind: input.asset_kind,
    asset_ref,
    identity,
    site_location,
    installation_date,
    condition_reference,
    configured_asset_policy_reference,
    service_history,
    expected_catalogue_asset_context: Object.freeze([...service.asset_context]),
    readiness_gaps: Object.freeze([...new Set(readiness_gaps)].sort()),
    context_complete: readiness_gaps.length === 0,
    asset_owner: 'shared_assets_inventory_owner',
    service_history_owner: 'shared_jobs_and_assets_service_history_owner',
    evidence_owner: 'shared_jobs_evidence_owner',
    site_owner: 'shared_crm_service_location_owner',
    vertical_context_is_projection: true,
    registers_asset: false,
    updates_asset: false,
    assigns_asset: false,
    mutates_service_history: false,
    grants_authority: false,
    execution_permitted: false,
    requires_fresh_authority_evaluation: true,
  });
}

export function getLicensedTradeAssetKinds(trade: LicensedTradeKey): readonly LicensedTradeAssetKind[] {
  if (!TRADE_ASSET_KINDS[trade]) throw new Error(`unsupported trade: ${trade}`);
  return TRADE_ASSET_KINDS[trade];
}
