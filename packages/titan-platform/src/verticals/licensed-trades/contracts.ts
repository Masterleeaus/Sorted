export const LICENSED_TRADES_PASS1_SCHEMA = 'titan.zero.vertical.licensed-trades.pass1.v1' as const;

export type LicensedTradeKey = 'plumbing' | 'electrical' | 'hvac';
export type LicensedTradePrimitive =
  | 'company_boundary'
  | 'service_scope'
  | 'risk_triage'
  | 'qualification_requirement'
  | 'safety_policy_reference'
  | 'asset_context'
  | 'evidence_requirement'
  | 'pricing_projection'
  | 'scheduling_requirement'
  | 'recurrence_projection'
  | 'customer_handoff';

export interface LicensedTradesPass1InventoryInput {
  company_id: string;
}

const LEGACY_BOUNDARY_KEYS = new Set([
  'tenant_id',
  'tenant_company_id',
  'tenantId',
  'tenantCompanyId',
  'workspace_tenant_id',
]);

function requireText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function rejectLegacyBoundary(value: unknown, path = 'input'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectLegacyBoundary(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (LEGACY_BOUNDARY_KEYS.has(key)) {
      throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is required`);
    }
    rejectLegacyBoundary(nested, `${path}.${key}`);
  }
}

export const LICENSED_TRADE_SHARED_PRIMITIVES: readonly LicensedTradePrimitive[] = Object.freeze([
  'company_boundary',
  'service_scope',
  'risk_triage',
  'qualification_requirement',
  'safety_policy_reference',
  'asset_context',
  'evidence_requirement',
  'pricing_projection',
  'scheduling_requirement',
  'recurrence_projection',
  'customer_handoff',
]);

export const LICENSED_TRADE_SHARED_OWNERS = Object.freeze({
  customer_and_business_records: 'shared_crm_business_records_owner',
  booking: 'shared_booking_owner',
  scheduling: 'shared_scheduling_owner',
  assignment: 'shared_workforce_assignment_owner',
  jobs: 'shared_jobs_owner',
  pricing_and_quotes: 'shared_pricing_quote_owner',
  assets_and_inventory: 'shared_assets_inventory_owner',
  recurrence_and_rebooking: 'shared_recurrence_rebooking_owner',
  customer_care: 'shared_customer_care_owner',
});

export const LICENSED_TRADE_DONOR_MATRIX = Object.freeze({
  plumbing: Object.freeze({
    construction_profile: 'packages/domain/src/construction-profiles/plumbing.ts',
    workforce_adapter: 'packages/titan-platform/src/ported/titan-plumbing-workforce.ts',
    donor_state: 'ADAPT',
    retained_strengths: Object.freeze([
      'scope and evidence semantics',
      'licensed-worker requirement semantics',
      'completion evidence/checklist semantics',
      'emergency/urgency coordination semantics',
      'asset/service-history semantics',
    ]),
  }),
  electrical: Object.freeze({
    construction_profile: 'packages/domain/src/construction-profiles/electrical.ts',
    workforce_adapter: 'packages/titan-platform/src/ported/titan-electrical-workforce.ts',
    donor_state: 'ADAPT',
    retained_strengths: Object.freeze([
      'scope and evidence semantics',
      'licensed-worker requirement semantics',
      'isolation/test evidence semantics',
      'emergency/no-power coordination semantics',
      'asset/service-history semantics',
    ]),
  }),
  hvac: Object.freeze({
    construction_profile: null,
    workforce_adapter: null,
    donor_state: 'GAP',
    retained_strengths: Object.freeze([
      'reuse shared jobs/scheduling/pricing/assets/recurrence primitives',
      'reuse Cleaning vertical composition blueprint',
    ]),
  }),
});

export function buildLicensedTradesPass1Inventory(input: LicensedTradesPass1InventoryInput) {
  rejectLegacyBoundary(input);
  const company_id = requireText(input.company_id, 'company_id');

  return Object.freeze({
    schema: LICENSED_TRADES_PASS1_SCHEMA,
    company_id,
    trades: Object.freeze(['plumbing', 'electrical', 'hvac'] as const),
    shared_primitives: LICENSED_TRADE_SHARED_PRIMITIVES,
    shared_owners: LICENSED_TRADE_SHARED_OWNERS,
    donor_matrix: LICENSED_TRADE_DONOR_MATRIX,
    composition_only: true,
    donor_identity_grants_authority: false,
    trade_selection_grants_authority: false,
    qualification_metadata_grants_authority: false,
    automatic_assignment: false,
    automatic_execution: false,
    safety_claims_from_vertical: false,
    jurisdiction_rules_must_be_configured: true,
    requires_fresh_authority_evaluation: true,
  });
}
