/**
 * Titan Zero marketplace commercial contract.
 *
 * Browser-neutral normalization layer for cleaning software, workforce agents,
 * templates and service add-ons. Existing browser marketplace adapters remain
 * authoritative for their own storage/mutations; this module only normalizes
 * identity, lifecycle and read-model projections and never grants authority.
 */

export type MarketplaceProductKind =
  | 'software_module'
  | 'workforce_agent'
  | 'template'
  | 'service_addon'
  | 'supply_product'
  | 'growth_product';

export type MarketplaceLifecycleState =
  | 'available'
  | 'shortlisted'
  | 'trial'
  | 'install_pending'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'upgrade_available'
  | 'upgrade_pending'
  | 'uninstall_pending'
  | 'uninstalled'
  | 'blocked'
  | 'not_suitable';

export type MarketplaceActionKind =
  | 'shortlist'
  | 'start_trial'
  | 'install'
  | 'enable'
  | 'disable'
  | 'upgrade'
  | 'uninstall'
  | 'review_value';

export interface MarketplaceCommercialIdentity {
  /** Stable cross-surface key. */
  product_key: string;
  source_id: string;
  kind: MarketplaceProductKind;
  name: string;
  category?: string;
  version?: string;
  provider?: string;
}

export interface MarketplaceCommercialTerms {
  currency?: string;
  price_minor?: number;
  billing_period?: 'once' | 'month' | 'year' | 'usage' | 'included';
  trial_days?: number;
  included?: boolean;
  entitlement_key?: string;
}

export interface MarketplaceInstallability {
  eligible: boolean;
  compatible: boolean;
  entitled: boolean;
  already_installed: boolean;
  can_install: boolean;
  blockers: string[];
}

export interface MarketplaceValueHealth {
  posture: 'unknown' | 'evidence_needed' | 'healthy' | 'review' | 'at_risk';
  uses_30d?: number;
  evidence_count_30d?: number;
  recurring_cost_minor?: number;
  recorded_benefit_minor?: number;
  net_value_minor?: number;
  reasons: string[];
}

export interface MarketplaceCommercialProjection {
  identity: MarketplaceCommercialIdentity;
  lifecycle: MarketplaceLifecycleState;
  terms: MarketplaceCommercialTerms;
  installability: MarketplaceInstallability;
  value_health: MarketplaceValueHealth;
  recommended_actions: MarketplaceActionKind[];
  /** Read models never confer purchase/install/remove authority. */
  grants_authority: false;
}

export interface MarketplaceProjectionInput {
  id: string;
  name?: string;
  kind?: MarketplaceProductKind | string;
  category?: string;
  version?: string;
  provider?: string;
  status?: string;
  eligible?: boolean;
  compatible?: boolean;
  entitled?: boolean;
  blockers?: string[];
  price_minor?: number;
  monthly_recurring_cost?: number;
  monthly_recurring_cost_minor?: number;
  currency?: string;
  billing_period?: MarketplaceCommercialTerms['billing_period'];
  trial_days?: number;
  included?: boolean;
  entitlement_key?: string;
  use_count_30d?: number;
  evidence_count_30d?: number;
  recorded_benefit_value_30d?: number;
  recorded_benefit_minor?: number;
}

const KIND_ALIASES: Record<string, MarketplaceProductKind> = {
  software: 'software_module',
  module: 'software_module',
  software_module: 'software_module',
  workforce: 'workforce_agent',
  workforce_agent: 'workforce_agent',
  agent: 'workforce_agent',
  crew: 'workforce_agent',
  template: 'template',
  service: 'service_addon',
  service_addon: 'service_addon',
  supply: 'supply_product',
  supply_product: 'supply_product',
  growth: 'growth_product',
  growth_product: 'growth_product',
};

const INSTALLED_STATES = new Set([
  'installed', 'enabled', 'using', 'purchased', 'included', 'active',
]);

const STATE_ALIASES: Record<string, MarketplaceLifecycleState> = {
  available: 'available',
  shortlisted: 'shortlisted',
  trial: 'trial',
  trialling: 'trial',
  installing: 'install_pending',
  install_pending: 'install_pending',
  installed: 'installed',
  using: 'enabled',
  active: 'enabled',
  enabled: 'enabled',
  purchased: 'installed',
  included: 'enabled',
  disabled: 'disabled',
  upgrade_available: 'upgrade_available',
  upgrading: 'upgrade_pending',
  upgrade_pending: 'upgrade_pending',
  removing: 'uninstall_pending',
  uninstall_pending: 'uninstall_pending',
  removed: 'uninstalled',
  uninstalled: 'uninstalled',
  blocked: 'blocked',
  not_suitable: 'not_suitable',
};

function cleanToken(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function normalizeMarketplaceKind(value: unknown): MarketplaceProductKind {
  const token = cleanToken(value);
  return KIND_ALIASES[token] ?? 'growth_product';
}

export function marketplaceProductKey(kind: MarketplaceProductKind | string, id: string): string {
  return `${normalizeMarketplaceKind(kind)}:${String(id).trim()}`;
}

export function normalizeMarketplaceLifecycle(status: unknown): MarketplaceLifecycleState {
  const token = cleanToken(status) || 'available';
  return STATE_ALIASES[token] ?? 'available';
}

export function deriveMarketplaceInstallability(input: MarketplaceProjectionInput): MarketplaceInstallability {
  const state = normalizeMarketplaceLifecycle(input.status);
  const blockers = [...new Set((input.blockers ?? []).map(String).filter(Boolean))];
  const eligible = input.eligible !== false;
  const compatible = input.compatible !== false;
  const entitled = input.entitled !== false || input.included === true;
  const already_installed = INSTALLED_STATES.has(cleanToken(input.status)) ||
    ['installed', 'enabled', 'disabled', 'upgrade_available', 'upgrade_pending'].includes(state);

  if (!eligible) blockers.push('not_eligible');
  if (!compatible) blockers.push('incompatible');
  if (!entitled) blockers.push('entitlement_required');
  if (already_installed) blockers.push('already_installed');

  return {
    eligible,
    compatible,
    entitled,
    already_installed,
    can_install: eligible && compatible && entitled && !already_installed,
    blockers: [...new Set(blockers)],
  };
}

function toMinorFromMajor(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function deriveMarketplaceValueHealth(input: MarketplaceProjectionInput): MarketplaceValueHealth {
  const uses = finiteNumber(input.use_count_30d);
  const evidence = finiteNumber(input.evidence_count_30d);
  const recurring = finiteNumber(input.monthly_recurring_cost_minor) ?? toMinorFromMajor(input.monthly_recurring_cost);
  const benefit = finiteNumber(input.recorded_benefit_minor) ?? toMinorFromMajor(input.recorded_benefit_value_30d);
  const net = recurring !== undefined && benefit !== undefined ? benefit - recurring : undefined;
  const reasons: string[] = [];

  if (uses === undefined && evidence === undefined && recurring === undefined && benefit === undefined) {
    return { posture: 'unknown', reasons: ['no_value_evidence_recorded'] };
  }
  if ((uses ?? 0) === 0 && (recurring ?? 0) > 0) reasons.push('unused_recurring_spend');
  if (net !== undefined && net < 0) reasons.push('negative_recorded_net_value');
  if ((uses ?? 0) > 0 && (evidence ?? 0) === 0) reasons.push('adoption_without_outcome_evidence');

  let posture: MarketplaceValueHealth['posture'] = 'evidence_needed';
  if (reasons.includes('unused_recurring_spend') || reasons.includes('negative_recorded_net_value')) posture = 'at_risk';
  else if ((uses ?? 0) >= 3 && (evidence ?? 0) >= 1 && (net === undefined || net >= 0)) posture = 'healthy';
  else if ((uses ?? 0) === 0 && recurring === undefined) posture = 'review';

  return {
    posture,
    uses_30d: uses,
    evidence_count_30d: evidence,
    recurring_cost_minor: recurring,
    recorded_benefit_minor: benefit,
    net_value_minor: net,
    reasons,
  };
}

export function projectMarketplaceCommercialProduct(input: MarketplaceProjectionInput): MarketplaceCommercialProjection {
  const kind = normalizeMarketplaceKind(input.kind ?? input.category);
  const lifecycle = normalizeMarketplaceLifecycle(input.status);
  const installability = deriveMarketplaceInstallability(input);
  const value_health = deriveMarketplaceValueHealth(input);
  const actions: MarketplaceActionKind[] = [];

  if (lifecycle === 'available') actions.push('shortlist');
  if (installability.can_install) actions.push(input.trial_days ? 'start_trial' : 'install');
  if (lifecycle === 'installed' || lifecycle === 'disabled') actions.push('enable');
  if (lifecycle === 'enabled') actions.push('disable');
  if (lifecycle === 'upgrade_available') actions.push('upgrade');
  if (installability.already_installed && !['uninstall_pending', 'uninstalled'].includes(lifecycle)) actions.push('uninstall');
  if (installability.already_installed) actions.push('review_value');

  return {
    identity: {
      product_key: marketplaceProductKey(kind, input.id),
      source_id: String(input.id),
      kind,
      name: input.name || String(input.id),
      category: input.category,
      version: input.version,
      provider: input.provider,
    },
    lifecycle,
    terms: {
      currency: input.currency,
      price_minor: finiteNumber(input.price_minor),
      billing_period: input.billing_period,
      trial_days: finiteNumber(input.trial_days),
      included: input.included,
      entitlement_key: input.entitlement_key,
    },
    installability,
    value_health,
    recommended_actions: [...new Set(actions)],
    grants_authority: false,
  };
}

export function projectMarketplaceCommercialCatalogue(inputs: MarketplaceProjectionInput[]): MarketplaceCommercialProjection[] {
  const seen = new Set<string>();
  const rows: MarketplaceCommercialProjection[] = [];
  for (const input of inputs) {
    const row = projectMarketplaceCommercialProduct(input);
    if (seen.has(row.identity.product_key)) continue;
    seen.add(row.identity.product_key);
    rows.push(row);
  }
  return rows.sort((a, b) => a.identity.product_key.localeCompare(b.identity.product_key));
}
