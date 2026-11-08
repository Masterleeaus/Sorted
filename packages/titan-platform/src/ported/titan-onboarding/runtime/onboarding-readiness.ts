// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-onboarding/runtime/onboarding-readiness.mjs
import { normalizeCompanyContext } from '../../titan-local/kernel/company-context.js';

const LEGACY_KEYS = new Set(['tenant_id','tenant_company_id','workspace_tenant_id','business_id']);
const clone = value => value == null ? value : globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function rejectLegacy(value, path='input') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((child,index)=>rejectLegacy(child,`${path}[${index}]`));
  for (const [key,child] of Object.entries(value)) {
    if (LEGACY_KEYS.has(key)) throw new Error(`${path}.${key} is a legacy company boundary; company_id is required`);
    rejectLegacy(child, `${path}.${key}`);
  }
}

function nonEmpty(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value != null && String(value).trim().length > 0;
}

function safetyBlocked(view) {
  if (!view || typeof view !== 'object') return false;
  const unsafeTrue = [
    'grants_authority','authority_granted','execution_permitted','live_mutation_permitted',
    'role_activation_permitted','worker_creation_permitted','scheduling_execution_permitted',
    'escalation_execution_permitted','money_movement_permitted','message_send_permitted',
    'provider_execution_permitted','notification_dispatch_permitted','dispatch_permitted',
  ];
  return unsafeTrue.some(key => view[key] === true);
}

function item(id, required, status, details={}, blockers=[]) {
  return Object.freeze({
    id,
    required,
    status,
    details:Object.freeze(clone(details || {})),
    blockers:Object.freeze([...blockers]),
  });
}

function businessItem(view) {
  if (!view || Number(view.revision || 0) <= 0) return item('business_setup', true, 'missing', { revision:0 });
  const blockers=[];
  if (safetyBlocked(view)) blockers.push('authority_or_execution_boundary_violation');
  if (!nonEmpty(view.identity?.legal_name || view.identity?.trading_name)) blockers.push('business_identity_missing');
  if (!nonEmpty(view.contact?.email) && !nonEmpty(view.contact?.phone)) blockers.push('business_contact_missing');
  if (!nonEmpty(view.service_areas)) blockers.push('service_areas_missing');
  if (!nonEmpty(view.operating_hours)) blockers.push('operating_hours_missing');
  return item('business_setup', true, blockers.length ? 'blocked' : 'configured', {
    revision:Number(view.revision || 0),
    identity_configured:nonEmpty(view.identity?.legal_name || view.identity?.trading_name),
    contact_configured:nonEmpty(view.contact?.email) || nonEmpty(view.contact?.phone),
    service_area_count:Array.isArray(view.service_areas) ? view.service_areas.length : 0,
    operating_hours_configured:nonEmpty(view.operating_hours),
  }, blockers);
}

function cleaningItem(view) {
  if (!view || Number(view.revision || 0) <= 0) return item('cleaning_services', true, 'missing', { revision:0, selected_job_types:0 });
  const blockers=[];
  if (safetyBlocked(view)) blockers.push('authority_or_execution_boundary_violation');
  const selections=Array.isArray(view.selections) ? view.selections : [];
  if (!selections.length) blockers.push('no_cleaning_services_selected');
  return item('cleaning_services', true, blockers.length ? 'blocked' : 'configured', {
    revision:Number(view.revision || 0),
    selected_job_types:selections.length,
  }, blockers);
}

function workforceItem(view) {
  if (!view || Number(view.revision || 0) <= 0) return item('workforce_setup', true, 'missing', { revision:0, enabled_roles:0 });
  const blockers=[];
  if (safetyBlocked(view)) blockers.push('authority_or_execution_boundary_violation');
  const roles=(Array.isArray(view.role_selections) ? view.role_selections : []).filter(row=>row?.enabled !== false);
  if (!roles.length) blockers.push('no_workforce_roles_enabled');
  if (!view.availability) blockers.push('availability_missing');
  return item('workforce_setup', true, blockers.length ? 'blocked' : 'configured', {
    revision:Number(view.revision || 0),
    enabled_roles:roles.length,
    availability_configured:Boolean(view.availability),
    escalation_defaults_count:Array.isArray(view.escalation_defaults) ? view.escalation_defaults.length : 0,
  }, blockers);
}

function paymentsItem(view) {
  if (!view || Number(view.revision || 0) <= 0) return item('payments_communications', false, 'optional', { revision:0, configured:false });
  const blockers=[];
  if (safetyBlocked(view)) blockers.push('authority_or_execution_boundary_violation');
  if (view.credentials_stored_in_onboarding === true) blockers.push('credentials_copied_into_onboarding');
  const paymentMethods=Array.isArray(view.payments?.methods) ? view.payments.methods.length : 0;
  const channels=Array.isArray(view.communications) ? view.communications.length : 0;
  if (!paymentMethods) blockers.push('payment_methods_missing');
  if (!channels) blockers.push('communication_channels_missing');
  return item('payments_communications', false, blockers.length ? 'blocked' : 'configured', {
    revision:Number(view.revision || 0),
    payment_methods:paymentMethods,
    communication_channels:channels,
    providers:Array.isArray(view.providers?.providers) ? view.providers.providers.length : 0,
  }, blockers);
}

function importItem(summary) {
  if (!summary) return item('import_data', false, 'optional', { staged:false });
  const blockers=[];
  if (summary.live_mutation_permitted === true || summary.execution_permitted === true || summary.authority_granted === true) blockers.push('import_staging_boundary_violation');
  if (Number(summary.invalid_count || summary.summary?.invalid_count || 0) > 0) blockers.push('invalid_staged_rows');
  return item('import_data', false, blockers.length ? 'blocked' : 'configured', {
    staged:true,
    import_id:summary.import_id || null,
    status:summary.status || 'STAGED',
    rollback_safe:summary.rollback_safe !== false,
  }, blockers);
}

function journeyItem(view) {
  if (!view) return item('journey_state', true, 'missing', { status:'not_started' });
  const blockers=[];
  if (view.grants_authority === true) blockers.push('journey_authority_boundary_violation');
  const status=String(view.status || 'not_started');
  return item('journey_state', true, blockers.length ? 'blocked' : status === 'not_started' ? 'missing' : 'configured', {
    status,
    current_step:view.current_step ?? null,
    completed_steps:Array.isArray(view.completed_steps) ? [...view.completed_steps] : [],
    skipped_optional_steps:Array.isArray(view.skipped_optional_steps) ? [...view.skipped_optional_steps] : [],
    revision:Number(view.revision || 0),
  }, blockers);
}

export function projectOnboardingReadiness(input={}) {
  rejectLegacy(input,'readiness');
  const company_id=String(input.company_id || '').trim();
  if (!company_id) throw new Error('company_id is required');
  const sources=['journey','business','cleaning','workforce','payments'];
  for (const source of sources) {
    const view=input[source];
    if (view?.company_id != null && String(view.company_id).trim() !== company_id) throw new Error(`Cross-company readiness source rejected: ${source}`);
  }
  const items=Object.freeze([
    journeyItem(input.journey),
    businessItem(input.business),
    cleaningItem(input.cleaning),
    workforceItem(input.workforce),
    paymentsItem(input.payments),
    importItem(input.imports),
  ]);
  const required=items.filter(row=>row.required);
  const blocked=items.filter(row=>row.status==='blocked');
  const missing=required.filter(row=>row.status==='missing');
  const configured=items.filter(row=>row.status==='configured');
  const optional=items.filter(row=>row.status==='optional');
  const operationally_ready=blocked.length===0 && missing.length===0;
  return Object.freeze({
    schema:'titan.onboarding.readiness.v1',
    company_id,
    status:blocked.length ? 'blocked' : missing.length ? 'missing' : 'ready',
    operationally_ready,
    items,
    counts:Object.freeze({
      configured:configured.length,
      missing:items.filter(row=>row.status==='missing').length,
      blocked:blocked.length,
      optional:optional.length,
      required_total:required.length,
      required_configured:required.filter(row=>row.status==='configured').length,
    }),
    blocked_ids:Object.freeze(blocked.map(row=>row.id)),
    missing_required_ids:Object.freeze(missing.map(row=>row.id)),
    optional_ids:Object.freeze(optional.map(row=>row.id)),
    read_only:true,
    derived:true,
    grants_authority:false,
    authority_granted:false,
    execution_permitted:false,
    automatic_execution:false,
  });
}

export function createOnboardingReadinessService({ journeyStore, businessSetup, cleaningSetup, workforceSetup, paymentsCommunicationsSetup }={}) {
  const requiredReaders=[['journeyStore',journeyStore],['businessSetup',businessSetup],['cleaningSetup',cleaningSetup],['workforceSetup',workforceSetup],['paymentsCommunicationsSetup',paymentsCommunicationsSetup]];
  for (const [name,reader] of requiredReaders) if (!reader || typeof reader.load !== 'function' && typeof reader.read !== 'function') throw new Error(`${name} reader is required`);

  async function readSource(name, reader, context) {
    try {
      return await (typeof reader.load === 'function' ? reader.load(context) : reader.read(context));
    } catch (error) {
      return Object.freeze({ company_id:context.company_id, revision:0, __readiness_error:String(error?.message || error), __source:name, authority_granted:false, execution_permitted:false });
    }
  }

  return Object.freeze({
    schema:'titan.onboarding.readiness-service.v1',
    company_boundary:'company_id',
    read_only:true,
    grants_authority:false,
    authority_granted:false,
    execution_permitted:false,
    async evaluate(contextInput, { import_summary=null }={}) {
      rejectLegacy(contextInput,'context');
      const context=normalizeCompanyContext(contextInput || {});
      const [journey,business,cleaning,workforce,payments]=await Promise.all([
        readSource('journey',journeyStore,context),
        readSource('business',businessSetup,context),
        readSource('cleaning',cleaningSetup,context),
        readSource('workforce',workforceSetup,context),
        readSource('payments',paymentsCommunicationsSetup,context),
      ]);
      const sourceErrors=[];
      for (const view of [journey,business,cleaning,workforce,payments]) if (view?.__readiness_error) sourceErrors.push(`${view.__source}:${view.__readiness_error}`);
      const projected=projectOnboardingReadiness({company_id:context.company_id,journey,business,cleaning,workforce,payments,imports:import_summary});
      if (!sourceErrors.length) return projected;
      return Object.freeze({
        ...projected,
        status:'blocked',
        operationally_ready:false,
        source_errors:Object.freeze(sourceErrors),
        blocked_ids:Object.freeze([...new Set([...projected.blocked_ids,'readiness_source_error'])]),
      });
    },
  });
}
