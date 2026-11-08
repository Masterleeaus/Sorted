import type { LicensedTradeKey } from './contracts.js';

export const LICENSED_TRADES_CATALOGUE_SCHEMA = 'titan.zero.vertical.licensed-trades.catalogue.v1' as const;

export type LicensedTradeServiceClass = 'FAULT' | 'MAINTENANCE' | 'INSTALLATION' | 'EMERGENCY' | 'COMPLIANCE';
export type LicensedTradeRiskBand = 'STANDARD' | 'ELEVATED' | 'HIGH';
export type LicensedTradeQuoteMode = 'QUOTE_ALLOWED' | 'ATTENDANCE_REQUIRED' | 'POLICY_DEPENDENT';

export interface LicensedTradeServiceDefinition {
  readonly service_key: string;
  readonly trade: LicensedTradeKey;
  readonly service_class: LicensedTradeServiceClass;
  readonly name: string;
  readonly description: string;
  readonly common_scope: readonly string[];
  readonly exclusions: readonly string[];
  readonly asset_context: readonly string[];
  readonly evidence_requirements: readonly string[];
  readonly qualification_tags: readonly string[];
  readonly risk_band: LicensedTradeRiskBand;
  readonly quote_mode: LicensedTradeQuoteMode;
  readonly emergency_capable: boolean;
  readonly compliance_oriented: boolean;
  readonly configured_policy_reference_required: boolean;
}

export interface LicensedTradesCatalogueInput {
  company_id: string;
  trades?: readonly LicensedTradeKey[];
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

const svc = (value: LicensedTradeServiceDefinition): LicensedTradeServiceDefinition => Object.freeze({
  ...value,
  common_scope: Object.freeze([...value.common_scope]),
  exclusions: Object.freeze([...value.exclusions]),
  asset_context: Object.freeze([...value.asset_context]),
  evidence_requirements: Object.freeze([...value.evidence_requirements]),
  qualification_tags: Object.freeze([...value.qualification_tags]),
});

export const LICENSED_TRADE_SERVICE_CATALOGUE: readonly LicensedTradeServiceDefinition[] = Object.freeze([
  svc({service_key:'plumbing.fault.leak-blockage',trade:'plumbing',service_class:'FAULT',name:'Leak / blockage diagnosis',description:'Investigate leaks, drainage restrictions and fixture faults.',common_scope:['fault intake','diagnostic attendance','repair recommendation'],exclusions:['unconfigured regulated remediation claims','automatic excavation authorization'],asset_context:['fixture','pipework','drain','hot-water connection'],evidence_requirements:['before-condition reference','diagnostic findings','repair/completion evidence when performed'],qualification_tags:['plumbing_licensed_work_when_required'],risk_band:'ELEVATED',quote_mode:'POLICY_DEPENDENT',emergency_capable:true,compliance_oriented:false,configured_policy_reference_required:true}),
  svc({service_key:'plumbing.maintenance.preventive',trade:'plumbing',service_class:'MAINTENANCE',name:'Plumbing maintenance visit',description:'Routine inspection and maintenance of plumbing fixtures and connected assets.',common_scope:['inspection','minor maintenance','condition reporting'],exclusions:['unapproved regulated alterations'],asset_context:['fixtures','valves','hot-water system','drainage'],evidence_requirements:['inspection checklist','condition notes'],qualification_tags:['plumbing_scope_match'],risk_band:'STANDARD',quote_mode:'QUOTE_ALLOWED',emergency_capable:false,compliance_oriented:false,configured_policy_reference_required:true}),
  svc({service_key:'plumbing.installation.fixture-system',trade:'plumbing',service_class:'INSTALLATION',name:'Fixture / plumbing system installation',description:'Install or replace configured plumbing fixtures or connected systems.',common_scope:['site readiness','installation','commissioning evidence'],exclusions:['scope outside configured licence/policy','structural work not included in approved scope'],asset_context:['fixture','water service','hot-water system'],evidence_requirements:['pre-install condition','installed asset reference','commissioning/completion evidence'],qualification_tags:['plumbing_licensed_worker_required'],risk_band:'HIGH',quote_mode:'POLICY_DEPENDENT',emergency_capable:false,compliance_oriented:true,configured_policy_reference_required:true}),
  svc({service_key:'plumbing.emergency.water-loss',trade:'plumbing',service_class:'EMERGENCY',name:'Urgent plumbing attendance',description:'Priority attendance for configured urgent plumbing conditions.',common_scope:['urgent triage','safe attendance coordination','stabilisation recommendation'],exclusions:['vertical-issued emergency guarantee','automatic unsafe-work instruction'],asset_context:['water service','fixture','pipework','hot-water system'],evidence_requirements:['triage record','arrival findings','handoff/completion evidence'],qualification_tags:['plumbing_licensed_worker_required'],risk_band:'HIGH',quote_mode:'ATTENDANCE_REQUIRED',emergency_capable:true,compliance_oriented:false,configured_policy_reference_required:true}),
  svc({service_key:'plumbing.compliance.inspection',trade:'plumbing',service_class:'COMPLIANCE',name:'Configured plumbing compliance inspection',description:'Inspection/evidence workflow against company-configured jurisdiction policy.',common_scope:['inspection','evidence capture','policy-reference outcome'],exclusions:['unconfigured legal certification claim'],asset_context:['regulated plumbing asset','site/service context'],evidence_requirements:['policy reference','inspection evidence','qualified sign-off reference'],qualification_tags:['plumbing_licensed_worker_required','configured_compliance_scope'],risk_band:'HIGH',quote_mode:'POLICY_DEPENDENT',emergency_capable:false,compliance_oriented:true,configured_policy_reference_required:true}),

  svc({service_key:'electrical.fault.power-circuit',trade:'electrical',service_class:'FAULT',name:'Electrical fault diagnosis',description:'Investigate loss of power, circuit faults, nuisance trips or electrical asset faults.',common_scope:['fault intake','diagnostic attendance','test-result capture'],exclusions:['remote safety declaration','automatic energisation/isolation instruction'],asset_context:['switchboard','circuit','outlet','connected equipment'],evidence_requirements:['fault findings','test evidence reference','completion state'],qualification_tags:['electrical_licensed_worker_required'],risk_band:'HIGH',quote_mode:'ATTENDANCE_REQUIRED',emergency_capable:true,compliance_oriented:false,configured_policy_reference_required:true}),
  svc({service_key:'electrical.maintenance.preventive',trade:'electrical',service_class:'MAINTENANCE',name:'Electrical preventive maintenance',description:'Configured inspection and maintenance of electrical assets.',common_scope:['inspection','maintenance','condition reporting'],exclusions:['unconfigured compliance certification'],asset_context:['switchboard','circuits','fixed electrical equipment'],evidence_requirements:['inspection checklist','test-result references'],qualification_tags:['electrical_licensed_worker_required'],risk_band:'ELEVATED',quote_mode:'POLICY_DEPENDENT',emergency_capable:false,compliance_oriented:false,configured_policy_reference_required:true}),
  svc({service_key:'electrical.installation.circuit-equipment',trade:'electrical',service_class:'INSTALLATION',name:'Circuit / electrical equipment installation',description:'Install or replace configured fixed electrical equipment or circuits.',common_scope:['site readiness','installation','test/commissioning evidence'],exclusions:['scope outside configured licence/policy'],asset_context:['switchboard','circuit','fixed equipment'],evidence_requirements:['isolation/safe-state reference','installation evidence','test/commissioning results'],qualification_tags:['electrical_licensed_worker_required'],risk_band:'HIGH',quote_mode:'POLICY_DEPENDENT',emergency_capable:false,compliance_oriented:true,configured_policy_reference_required:true}),
  svc({service_key:'electrical.emergency.no-power-hazard',trade:'electrical',service_class:'EMERGENCY',name:'Urgent electrical attendance',description:'Priority attendance for configured electrical outage or hazard conditions.',common_scope:['urgent triage','qualified attendance','safe-state evidence placeholder'],exclusions:['vertical-issued make-safe guarantee','remote hazardous-work instruction'],asset_context:['supply','switchboard','circuit','affected equipment'],evidence_requirements:['triage record','qualified attendance reference','safe-state/completion evidence'],qualification_tags:['electrical_licensed_worker_required'],risk_band:'HIGH',quote_mode:'ATTENDANCE_REQUIRED',emergency_capable:true,compliance_oriented:false,configured_policy_reference_required:true}),
  svc({service_key:'electrical.compliance.inspection',trade:'electrical',service_class:'COMPLIANCE',name:'Configured electrical compliance inspection',description:'Inspection/evidence workflow against company-configured jurisdiction policy.',common_scope:['inspection','testing','evidence and sign-off reference'],exclusions:['unconfigured legal certification claim'],asset_context:['switchboard','circuits','fixed equipment'],evidence_requirements:['configured policy reference','test results','qualified sign-off reference'],qualification_tags:['electrical_licensed_worker_required','configured_compliance_scope'],risk_band:'HIGH',quote_mode:'POLICY_DEPENDENT',emergency_capable:false,compliance_oriented:true,configured_policy_reference_required:true}),

  svc({service_key:'hvac.fault.no-cooling-heating',trade:'hvac',service_class:'FAULT',name:'HVAC fault diagnosis',description:'Investigate no-cooling/no-heating, airflow, control or equipment faults.',common_scope:['fault intake','diagnostic attendance','repair recommendation'],exclusions:['refrigerant or electrical work outside configured qualification scope'],asset_context:['indoor unit','outdoor unit','controls','ducting/airflow'],evidence_requirements:['fault findings','asset identification','diagnostic evidence'],qualification_tags:['hvac_scope_match','configured_refrigerant_or_electrical_qualification_when_required'],risk_band:'ELEVATED',quote_mode:'POLICY_DEPENDENT',emergency_capable:true,compliance_oriented:false,configured_policy_reference_required:true}),
  svc({service_key:'hvac.maintenance.preventive',trade:'hvac',service_class:'MAINTENANCE',name:'HVAC preventive maintenance',description:'Routine service of configured HVAC/air-conditioning equipment.',common_scope:['inspection','clean/service tasks','condition reporting'],exclusions:['unapproved refrigerant intervention','unapproved electrical modification'],asset_context:['indoor unit','outdoor unit','filters','drain','controls'],evidence_requirements:['maintenance checklist','condition notes','asset/service-history reference'],qualification_tags:['hvac_scope_match'],risk_band:'STANDARD',quote_mode:'QUOTE_ALLOWED',emergency_capable:false,compliance_oriented:false,configured_policy_reference_required:true}),
  svc({service_key:'hvac.installation.system',trade:'hvac',service_class:'INSTALLATION',name:'HVAC system installation / replacement',description:'Install or replace configured HVAC equipment with commissioning evidence.',common_scope:['site readiness','installation','commissioning'],exclusions:['work outside configured refrigerant/electrical/licence policy'],asset_context:['indoor unit','outdoor unit','controls','refrigerant circuit','electrical supply'],evidence_requirements:['asset details','installation evidence','commissioning/test results'],qualification_tags:['hvac_installation_scope','configured_refrigerant_or_electrical_qualification_when_required'],risk_band:'HIGH',quote_mode:'POLICY_DEPENDENT',emergency_capable:false,compliance_oriented:true,configured_policy_reference_required:true}),
  svc({service_key:'hvac.emergency.critical-failure',trade:'hvac',service_class:'EMERGENCY',name:'Urgent HVAC attendance',description:'Priority attendance for configured critical HVAC failures or vulnerable-site conditions.',common_scope:['urgent triage','attendance coordination','stabilisation recommendation'],exclusions:['vertical-issued safety guarantee','automatic bypass of qualification gates'],asset_context:['HVAC system','controls','site criticality context'],evidence_requirements:['triage record','arrival findings','handoff/completion evidence'],qualification_tags:['hvac_scope_match'],risk_band:'HIGH',quote_mode:'ATTENDANCE_REQUIRED',emergency_capable:true,compliance_oriented:false,configured_policy_reference_required:true}),
  svc({service_key:'hvac.compliance.inspection',trade:'hvac',service_class:'COMPLIANCE',name:'Configured HVAC compliance inspection',description:'Inspection/evidence workflow for configured HVAC/refrigerant/electrical policy requirements.',common_scope:['inspection','configured tests','evidence/sign-off reference'],exclusions:['unconfigured regulatory certification claim'],asset_context:['HVAC system','refrigerant/electrical components'],evidence_requirements:['configured policy reference','inspection/test evidence','qualified sign-off reference'],qualification_tags:['configured_compliance_scope','hvac_scope_match'],risk_band:'HIGH',quote_mode:'POLICY_DEPENDENT',emergency_capable:false,compliance_oriented:true,configured_policy_reference_required:true}),
]);

export function buildLicensedTradeServiceCatalogue(input: LicensedTradesCatalogueInput) {
  rejectLegacyBoundary(input);
  const company_id = requireText(input.company_id, 'company_id');
  const trades = input.trades?.length ? [...new Set(input.trades)] : ['plumbing','electrical','hvac'] as LicensedTradeKey[];
  for (const trade of trades) if (!['plumbing','electrical','hvac'].includes(trade)) throw new Error(`unsupported trade: ${trade}`);
  const services = LICENSED_TRADE_SERVICE_CATALOGUE.filter((entry) => trades.includes(entry.trade));
  return Object.freeze({
    schema: LICENSED_TRADES_CATALOGUE_SCHEMA,
    company_id,
    trades: Object.freeze(trades),
    services: Object.freeze(services),
    service_count: services.length,
    canonical_service_selection_owner: 'licensed_trades_vertical_configuration',
    pricing_owner: 'shared_pricing_quote_owner',
    booking_owner: 'shared_booking_owner',
    scheduling_owner: 'shared_scheduling_owner',
    assignment_owner: 'shared_workforce_assignment_owner',
    jobs_owner: 'shared_jobs_owner',
    compliance_policy_owner: 'company_configured_jurisdiction_policy_owner',
    catalogue_grants_authority: false,
    service_selection_grants_authority: false,
    qualification_metadata_grants_authority: false,
    automatic_assignment: false,
    automatic_execution: false,
    automatic_compliance_certification: false,
    requires_fresh_authority_evaluation: true,
  });
}
