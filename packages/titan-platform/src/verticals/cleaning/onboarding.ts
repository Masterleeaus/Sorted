import { CLEANING_SERVICE_BY_ID } from './catalogue.js';
import type { CleaningPricingMode, CleaningFrequency } from './pricing.js';

export const CLEANING_ONBOARDING_SCHEMA = 'titan.vertical.cleaning.onboarding-setup.v1' as const;

export interface CleaningServiceArea {
  id: string;
  label: string;
  postcodes?: readonly string[];
  suburbs?: readonly string[];
  travel_radius_km?: number;
}

export interface CleaningOperatingWindow {
  day: 'monday'|'tuesday'|'wednesday'|'thursday'|'friday'|'saturday'|'sunday';
  start: string;
  end: string;
}

export interface CleaningOnboardingSetupInput {
  company_id: string;
  offered_service_ids: readonly string[];
  service_areas: readonly CleaningServiceArea[];
  enabled_pricing_modes: readonly CleaningPricingMode[];
  configured_pricing?: readonly CleaningServicePricingConfiguration[];
  team_capacity: { default_crew_size: number; max_parallel_crews: number; max_workers_per_crew: number };
  operating_hours: readonly CleaningOperatingWindow[];
  equipment_defaults?: readonly string[];
  supply_defaults?: readonly string[];
  recurring?: { enabled: boolean; supported_frequencies?: readonly Exclude<CleaningFrequency,'one_off'>[]; default_frequency?: Exclude<CleaningFrequency,'one_off'> };
}

export interface CleaningServicePricingConfiguration {
  service_id: string;
  mode: 'fixed'|'hourly'|'quote_required';
  fixed_price?: number;
  hourly_rate?: number;
  minimum_charge?: number;
  currency?: string;
}

export interface CleaningOnboardingProjection {
  schema: typeof CLEANING_ONBOARDING_SCHEMA;
  company_id: string;
  offered_services: readonly Readonly<{ service_id:string; label:string; recurring_supported:boolean; default_crew_size:number; pricing_hints:readonly string[] }> [];
  service_areas: readonly CleaningServiceArea[];
  enabled_pricing_modes: readonly CleaningPricingMode[];
  configured_pricing: readonly Readonly<CleaningServicePricingConfiguration>[];
  team_capacity: Readonly<{ default_crew_size:number; max_parallel_crews:number; max_workers_per_crew:number }>;
  operating_hours: readonly CleaningOperatingWindow[];
  equipment_defaults: readonly string[];
  supply_defaults: readonly string[];
  recurring: Readonly<{ enabled:boolean; supported_frequencies:readonly string[]; default_frequency:string|null }>;
  retained_onboarding_authority: 'titan.onboarding.cleaning-service-setup-authority.v1';
  retained_catalogue_copy_permitted: false;
  configuration_only: true;
  grants_authority: false;
  execution_permitted: false;
  persists_business_truth: false;
}

const LEGACY_COMPANY_KEYS = new Set(['tenant_id','tenant_company_id','workspace_tenant_id','tenantId','tenantCompanyId']);
function rejectLegacy(value: unknown, path='input'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`)); return; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (LEGACY_COMPANY_KEYS.has(key)) throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is required`);
    rejectLegacy(child, `${path}.${key}`);
  }
}

function clean(value: unknown): string { return String(value ?? '').trim(); }
function positiveInt(value: unknown, label: string): number {
  const n=Number(value); if (!Number.isInteger(n) || n < 1) throw new Error(`${label} must be an integer >= 1`); return n;
}
function configuredAmount(value: unknown, label: string): number | undefined {
  if (value == null || value === '') return undefined;
  const amount=Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} must be a finite non-negative amount`);
  return Math.round(amount * 100) / 100;
}
function time(value: unknown, label:string): string {
  const v=clean(value); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error(`${label} must use HH:MM`); return v;
}

export function buildCleaningOnboardingSetup(input: CleaningOnboardingSetupInput): CleaningOnboardingProjection {
  rejectLegacy(input);
  const company_id=clean(input.company_id); if (!company_id) throw new Error('company_id is required');
  const ids=[...new Set((input.offered_service_ids||[]).map(clean).filter(Boolean))];
  if (!ids.length) throw new Error('at least one cleaning service is required');
  const offered=ids.map(service_id=>{
    const service=CLEANING_SERVICE_BY_ID[service_id]; if (!service) throw new Error(`unknown cleaning service id: ${service_id}`);
    return Object.freeze({service_id,label:service.label,recurring_supported:service.recurring_supported,default_crew_size:service.default_crew_size,pricing_hints:service.pricing_hints});
  });
  const modes=[...new Set(input.enabled_pricing_modes||[])];
  if (!modes.length) throw new Error('at least one pricing mode is required');
  const allowedModes=new Set(['hourly','fixed','per_room','per_area','quote_required']);
  for (const mode of modes) if (!allowedModes.has(mode)) throw new Error(`unsupported cleaning pricing mode: ${mode}`);
  const configuredPricing=(input.configured_pricing||[]).map((configuration,index)=>{
    const serviceId=clean(configuration.service_id);
    const service=CLEANING_SERVICE_BY_ID[serviceId];
    if (!service || !ids.includes(serviceId)) throw new Error(`configured_pricing[${index}] must reference a selected cleaning service`);
    const mode=clean(configuration.mode).toLowerCase();
    if (!['fixed','hourly','quote_required'].includes(mode)) throw new Error(`configured pricing mode for ${serviceId} must be fixed, hourly, or quote_required`);
    if (!modes.includes(mode as CleaningPricingMode) || !service.pricing_hints.includes(mode as CleaningPricingMode)) {
      throw new Error(`configured pricing mode ${mode} is not enabled and supported for cleaning service ${serviceId}`);
    }
    if (service.quote_required && mode !== 'quote_required') throw new Error(`${serviceId} requires quote_required pricing`);
    const fixed_price=configuredAmount(configuration.fixed_price,`${serviceId}.fixed_price`);
    const hourly_rate=configuredAmount(configuration.hourly_rate,`${serviceId}.hourly_rate`);
    const minimum_charge=configuredAmount(configuration.minimum_charge,`${serviceId}.minimum_charge`);
    if (mode==='fixed' && fixed_price==null) throw new Error(`${serviceId}.fixed_price is required for fixed pricing configuration`);
    if (mode==='hourly' && hourly_rate==null) throw new Error(`${serviceId}.hourly_rate is required for hourly pricing configuration`);
    const currency=clean(configuration.currency||'AUD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`${serviceId}.currency must be a three-letter currency code`);
    return Object.freeze({service_id:serviceId,mode:mode as CleaningServicePricingConfiguration['mode'],fixed_price,hourly_rate,minimum_charge,currency});
  });
  if (new Set(configuredPricing.map(configuration=>configuration.service_id)).size!==configuredPricing.length) throw new Error('duplicate configured cleaning service pricing');
  const areas=(input.service_areas||[]).map((area,index)=>{
    const id=clean(area.id); const label=clean(area.label); if(!id||!label) throw new Error(`service_areas[${index}] requires id and label`);
    const radius=area.travel_radius_km==null?undefined:Number(area.travel_radius_km); if(radius!=null&&(!Number.isFinite(radius)||radius<0)) throw new Error(`service_areas[${index}].travel_radius_km must be non-negative`);
    return Object.freeze({id,label,postcodes:Object.freeze([...(area.postcodes||[])].map(clean).filter(Boolean)),suburbs:Object.freeze([...(area.suburbs||[])].map(clean).filter(Boolean)),travel_radius_km:radius});
  });
  if (!areas.length) throw new Error('at least one cleaning service area is required');
  const windows=(input.operating_hours||[]).map((window,index)=>{
    const start=time(window.start,`operating_hours[${index}].start`); const end=time(window.end,`operating_hours[${index}].end`);
    if (start>=end) throw new Error(`operating_hours[${index}] end must be after start`);
    return Object.freeze({day:window.day,start,end});
  });
  if (!windows.length) throw new Error('at least one operating window is required');
  const team=Object.freeze({
    default_crew_size:positiveInt(input.team_capacity?.default_crew_size,'default_crew_size'),
    max_parallel_crews:positiveInt(input.team_capacity?.max_parallel_crews,'max_parallel_crews'),
    max_workers_per_crew:positiveInt(input.team_capacity?.max_workers_per_crew,'max_workers_per_crew')
  });
  if (team.default_crew_size>team.max_workers_per_crew) throw new Error('default_crew_size cannot exceed max_workers_per_crew');
  if (input.recurring?.enabled!=null && typeof input.recurring.enabled!=='boolean') throw new Error('recurring.enabled must be a boolean');
  const recurringEnabled=input.recurring?.enabled===true;
  const frequencies=[...new Set(input.recurring?.supported_frequencies||[])];
  const allowedFrequency=new Set(['weekly','fortnightly','monthly','custom']);
  for(const f of frequencies) if(!allowedFrequency.has(f)) throw new Error(`unsupported recurring frequency: ${f}`);
  const defaultFrequency=input.recurring?.default_frequency ?? null;
  if(defaultFrequency && !frequencies.includes(defaultFrequency)) throw new Error('default recurring frequency must be enabled');
  if(recurringEnabled&&!frequencies.length) throw new Error('recurring enabled but no supported recurring frequencies are configured');
  if(recurringEnabled && !offered.some(service=>service.recurring_supported)) throw new Error('recurring enabled but no selected service supports recurrence');

  return Object.freeze({
    schema:CLEANING_ONBOARDING_SCHEMA,company_id,offered_services:Object.freeze(offered),service_areas:Object.freeze(areas),enabled_pricing_modes:Object.freeze(modes),configured_pricing:Object.freeze(configuredPricing),team_capacity:team,operating_hours:Object.freeze(windows),
    equipment_defaults:Object.freeze([...(input.equipment_defaults||[])].map(clean).filter(Boolean)),
    supply_defaults:Object.freeze([...(input.supply_defaults||[])].map(clean).filter(Boolean)),
    recurring:Object.freeze({enabled:recurringEnabled,supported_frequencies:Object.freeze(frequencies),default_frequency:defaultFrequency}),
    retained_onboarding_authority:'titan.onboarding.cleaning-service-setup-authority.v1',retained_catalogue_copy_permitted:false as const,configuration_only:true as const,grants_authority:false as const,execution_permitted:false as const,persists_business_truth:false as const
  });
}

export function toRetainedCleaningServiceSetupPayload(setup: CleaningOnboardingProjection) {
  const selectedJobTypes=new Set<string>();
  const selections=setup.offered_services.map(service => {
    const catalogueService=CLEANING_SERVICE_BY_ID[service.service_id];
    const job_type_id=catalogueService?.retained_job_type_id;
    if (!job_type_id) throw new Error(`cleaning service ${service.service_id} has no retained job type mapping and cannot be configured`);
    if (selectedJobTypes.has(job_type_id)) throw new Error(`selected cleaning services collide on retained job type ${job_type_id}; choose one service variant for this setup`);
    selectedJobTypes.add(job_type_id);
    const configured=setup.configured_pricing.find(pricing=>pricing.service_id===service.service_id);
    const mode=configured?.mode ?? (catalogueService.default_pricing_hint==='quote_required'?'quote_required':catalogueService.default_pricing_hint);
    if (!['fixed','hourly','quote_required'].includes(mode)) {
      throw new Error(`${service.service_id} requires pricing configuration in a supported fixed, hourly, or quote_required mode`);
    }
    if (!setup.enabled_pricing_modes.includes(mode)) throw new Error(`pricing mode ${mode} is not enabled for cleaning service ${service.service_id}`);
    if (catalogueService.quote_required && mode!=='quote_required') throw new Error(`${service.service_id} requires quote_required pricing`);
    if (mode==='fixed' && configured?.fixed_price==null) throw new Error(`${service.service_id}.fixed_price is required before saving cleaning service setup`);
    if (mode==='hourly' && configured?.hourly_rate==null) throw new Error(`${service.service_id}.hourly_rate is required before saving cleaning service setup`);
    return Object.freeze({
      job_type_id,
      service_label: service.label,
      enabled: true,
      pricing: Object.freeze({
        mode,
        fixed_price: configured?.fixed_price ?? null,
        hourly_rate: configured?.hourly_rate ?? null,
        minimum_charge: configured?.minimum_charge ?? null,
        currency: configured?.currency ?? 'AUD'
      })
    });
  });
  const recurringJobTypeIds=setup.recurring.enabled
    ? setup.offered_services.filter(service=>service.recurring_supported).map(service=>CLEANING_SERVICE_BY_ID[service.service_id]?.retained_job_type_id).filter((id):id is string=>!!id)
    : [];
  const runtimeFrequency=(frequency:string)=>frequency==='custom'?'custom_recurring':frequency;
  return Object.freeze({
    company_id: setup.company_id,
    selections: Object.freeze(selections),
    recurrence: Object.freeze({
      enabled: setup.recurring.enabled,
      supported_frequencies: Object.freeze(setup.recurring.supported_frequencies.map(runtimeFrequency)),
      default_frequency: setup.recurring.default_frequency ? runtimeFrequency(setup.recurring.default_frequency) : null,
      supported_job_type_ids: Object.freeze([...new Set(recurringJobTypeIds)])
    }),
    projection_only: true,
    requires_retained_onboarding_authority: true,
    grants_authority: false,
    execution_permitted: false
  });
}
