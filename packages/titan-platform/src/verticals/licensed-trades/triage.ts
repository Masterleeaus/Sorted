import { LICENSED_TRADE_SERVICE_CATALOGUE, type LicensedTradeServiceDefinition } from './catalogue.js';
import type { LicensedTradeKey } from './contracts.js';

export const LICENSED_TRADES_TRIAGE_SCHEMA = 'titan.zero.vertical.licensed-trades.triage.v1' as const;

export type LicensedTradeUrgency = 'ROUTINE' | 'PRIORITY' | 'URGENT' | 'EMERGENCY';
export type LicensedTradeTriageDecision = 'QUOTE_ALLOWED' | 'ATTENDANCE_REQUIRED' | 'MANUAL_REVIEW';
export type LicensedTradeRiskSignal =
  | 'IMMEDIATE_DANGER_REPORTED'
  | 'ACTIVE_DAMAGE_REPORTED'
  | 'ESSENTIAL_SERVICE_LOSS'
  | 'VULNERABLE_SITE'
  | 'AFTER_HOURS'
  | 'UNKNOWN_CONDITION'
  | 'COMPLIANCE_REQUEST';

export interface LicensedTradeTriageInput {
  company_id: string;
  trade: LicensedTradeKey;
  service_key: string;
  customer_report?: string;
  risk_signals?: readonly LicensedTradeRiskSignal[];
  configured_policy_reference?: string | null;
  requested_outcome?: 'QUOTE' | 'ATTENDANCE' | 'BOOKING';
  scope_confirmed?: boolean;
  asset_context_available?: boolean;
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

const COMMON_QUESTIONS = Object.freeze([
  'What outcome is the customer requesting: quote, attendance or booking?',
  'What changed, when was it first noticed, and is the condition still present?',
  'Which asset, fixture, circuit, unit or area is affected?',
  'Has any prior diagnosis, repair or service already been performed?',
]);

const TRADE_QUESTIONS: Readonly<Record<LicensedTradeKey, readonly string[]>> = Object.freeze({
  plumbing: Object.freeze([
    'Is water flow, drainage or hot-water service affected?',
    'Is active damage or continued water loss being reported?',
    'Which fixture, pipework, drain or hot-water asset is involved?',
  ]),
  electrical: Object.freeze([
    'Is supply, a circuit, switchboard, outlet, lighting or connected equipment affected?',
    'Has the customer reported heat, smoke, arcing, shock/contact or repeated protective-device operation?',
    'Which circuit, switchboard or electrical asset is involved?',
  ]),
  hvac: Object.freeze([
    'Is heating, cooling, airflow, controls or the complete HVAC system affected?',
    'Is the site temperature-sensitive or serving vulnerable occupants/processes?',
    'Which indoor unit, outdoor unit, controller or system is involved?',
  ]),
});

function findService(input: LicensedTradeTriageInput): LicensedTradeServiceDefinition {
  const service_key = requireText(input.service_key, 'service_key');
  const service = LICENSED_TRADE_SERVICE_CATALOGUE.find((entry) => entry.service_key === service_key);
  if (!service) throw new Error(`unknown licensed-trade service: ${service_key}`);
  if (service.trade !== input.trade) throw new Error(`service ${service_key} does not belong to trade ${input.trade}`);
  return service;
}

function maxUrgency(a: LicensedTradeUrgency, b: LicensedTradeUrgency): LicensedTradeUrgency {
  const rank: Record<LicensedTradeUrgency, number> = { ROUTINE: 0, PRIORITY: 1, URGENT: 2, EMERGENCY: 3 };
  return rank[b] > rank[a] ? b : a;
}

export function buildLicensedTradeIntakeQuestions(trade: LicensedTradeKey, service_key?: string) {
  if (!['plumbing','electrical','hvac'].includes(trade)) throw new Error(`unsupported trade: ${trade}`);
  const service = service_key ? LICENSED_TRADE_SERVICE_CATALOGUE.find((entry) => entry.service_key === service_key) : undefined;
  if (service_key && !service) throw new Error(`unknown licensed-trade service: ${service_key}`);
  if (service && service.trade !== trade) throw new Error(`service ${service_key} does not belong to trade ${trade}`);
  return Object.freeze({
    trade,
    service_key: service?.service_key ?? null,
    questions: Object.freeze([
      ...COMMON_QUESTIONS,
      ...TRADE_QUESTIONS[trade],
      ...(service?.compliance_oriented ? ['Which configured compliance/policy reference applies to this request?'] : []),
      ...(service?.qualification_tags.length ? ['Which configured qualification requirements must the shared assignment owner verify?'] : []),
    ]),
    questions_are_intake_prompts_only: true,
    questions_are_safety_instructions: false,
    questions_grant_authority: false,
  });
}

export function evaluateLicensedTradeTriage(input: LicensedTradeTriageInput) {
  rejectLegacyBoundary(input);
  const company_id = requireText(input.company_id, 'company_id');
  const service = findService(input);
  const signals = Object.freeze([...new Set(input.risk_signals ?? [])]);
  const reasons: string[] = [];
  let urgency: LicensedTradeUrgency = service.service_class === 'EMERGENCY' ? 'EMERGENCY' : 'ROUTINE';

  if (service.service_class === 'EMERGENCY') reasons.push('service_class_emergency');
  if (signals.includes('IMMEDIATE_DANGER_REPORTED')) {
    urgency = 'EMERGENCY';
    reasons.push('immediate_danger_reported');
  }
  if (signals.includes('ACTIVE_DAMAGE_REPORTED')) {
    urgency = maxUrgency(urgency, 'URGENT');
    reasons.push('active_damage_reported');
  }
  if (signals.includes('ESSENTIAL_SERVICE_LOSS')) {
    urgency = maxUrgency(urgency, 'URGENT');
    reasons.push('essential_service_loss');
  }
  if (signals.includes('VULNERABLE_SITE')) {
    urgency = maxUrgency(urgency, 'PRIORITY');
    reasons.push('vulnerable_site');
  }
  if (signals.includes('AFTER_HOURS')) {
    urgency = maxUrgency(urgency, 'PRIORITY');
    reasons.push('after_hours');
  }
  if (signals.includes('UNKNOWN_CONDITION')) reasons.push('unknown_condition');
  if (signals.includes('COMPLIANCE_REQUEST') || service.compliance_oriented) reasons.push('compliance_oriented');

  const policyRequired = service.configured_policy_reference_required || service.compliance_oriented;
  const hasPolicy = Boolean(String(input.configured_policy_reference ?? '').trim());
  const missingPolicy = policyRequired && !hasPolicy;
  if (missingPolicy) reasons.push('configured_policy_reference_missing');

  let decision: LicensedTradeTriageDecision = 'QUOTE_ALLOWED';
  if (urgency === 'EMERGENCY' || urgency === 'URGENT' || service.quote_mode === 'ATTENDANCE_REQUIRED') {
    decision = 'ATTENDANCE_REQUIRED';
  } else if (
    service.quote_mode === 'POLICY_DEPENDENT' ||
    service.risk_band === 'HIGH' ||
    signals.includes('UNKNOWN_CONDITION') ||
    signals.includes('COMPLIANCE_REQUEST') ||
    missingPolicy ||
    input.scope_confirmed === false
  ) {
    decision = 'MANUAL_REVIEW';
  }

  if (input.requested_outcome === 'QUOTE' && decision !== 'QUOTE_ALLOWED') reasons.push('quote_request_requires_review_or_attendance');
  if (input.asset_context_available === false && service.asset_context.length) reasons.push('asset_context_missing');

  return Object.freeze({
    schema: LICENSED_TRADES_TRIAGE_SCHEMA,
    company_id,
    trade: input.trade,
    service_key: service.service_key,
    service_class: service.service_class,
    urgency,
    decision,
    risk_band: service.risk_band,
    risk_signals: signals,
    reasons: Object.freeze([...new Set(reasons)]),
    intake: buildLicensedTradeIntakeQuestions(input.trade, service.service_key),
    configured_policy_reference_present: hasPolicy,
    emergency_policy_owner: 'company_configured_emergency_policy_owner',
    safety_instruction_owner: 'company_configured_safety_script_owner',
    quote_owner: 'shared_pricing_quote_owner',
    booking_owner: 'shared_booking_owner',
    scheduling_owner: 'shared_scheduling_owner',
    dispatch_assignment_owner: 'shared_workforce_assignment_owner',
    jobs_owner: 'shared_jobs_owner',
    qualification_owner: 'shared_workforce_qualification_owner',
    vertical_issues_safety_instruction: false,
    vertical_certifies_compliance: false,
    vertical_dispatches_automatically: false,
    vertical_books_automatically: false,
    vertical_quotes_automatically: false,
    vertical_grants_authority: false,
    requires_fresh_authority_evaluation: true,
  });
}
