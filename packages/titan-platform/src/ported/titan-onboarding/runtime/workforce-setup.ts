// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-onboarding/runtime/workforce-setup.mjs
import { normalizeCompanyContext } from '../../titan-local/kernel/company-context.js';

const LEGACY_KEYS = new Set(['tenant_id','tenant_company_id','workspace_tenant_id']);
const SEVERITIES = new Set(['low','medium','high','critical']);
const DAYS = Object.freeze(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']);
const DAY_SET = new Set(DAYS);
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const clone = value => value == null ? value : (globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
const clean = (value,max=240) => String(value ?? '').trim().slice(0,max);

function rejectLegacy(value,path='input') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((child,index)=>rejectLegacy(child,`${path}[${index}]`));
  for (const [key,child] of Object.entries(value)) {
    if (LEGACY_KEYS.has(key)) throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is the only company boundary`);
    rejectLegacy(child,`${path}.${key}`);
  }
}

function assertCatalogue(catalogue) {
  if (!catalogue || typeof catalogue !== 'object' || !Array.isArray(catalogue.roles)) throw new Error('installed workforce catalogue is required');
  if (catalogue.company_boundary !== 'company_id') throw new Error('workforce catalogue must use company_id boundary');
  const map = new Map();
  for (const raw of catalogue.roles) {
    const id = clean(raw?.role_definition_id,180);
    if (!id || map.has(id)) throw new Error('workforce catalogue role ids must be unique');
    map.set(id,Object.freeze({
      role_definition_id:id,
      name:clean(raw?.name,180),
      division_key:clean(raw?.division_key,80)||null,
      risk_ceiling:clean(raw?.risk_ceiling,40)||null,
      verticals:Object.freeze((raw?.verticals || []).map(x=>clean(x,80)).filter(Boolean)),
      operational_domains:Object.freeze((raw?.operational_domains || []).map(x=>clean(x,80)).filter(Boolean)),
      activation_confers_authority:false,
    }));
  }
  return map;
}

function normalizeRoles(values,roleMap) {
  const rows = Array.isArray(values) ? values : [];
  if (!rows.length) throw new Error('at least one workforce role selection is required');
  const out = rows.map((raw,index)=>{
    const id = clean(raw?.role_definition_id || raw?.role_id,180);
    const role = roleMap.get(id);
    if (!role) throw new Error(`unknown workforce role: ${id || `<row-${index+1}>`}`);
    const target = raw?.target_worker_count == null ? 1 : Number(raw.target_worker_count);
    if (!Number.isInteger(target) || target < 0 || target > 1000) throw new Error(`${id}.target_worker_count must be an integer between 0 and 1000`);
    return Object.freeze({
      role_definition_id:id,
      role_name:role.name,
      division_key:role.division_key,
      enabled:raw?.enabled !== false,
      target_worker_count:target,
      source:'installed-client-workforce-master',
      activation_requested:false,
      workers_created:false,
      grants_authority:false,
    });
  });
  if (new Set(out.map(x=>x.role_definition_id)).size !== out.length) throw new Error('duplicate workforce role selection');
  return Object.freeze(out);
}

function normalizeWindow(raw,label) {
  const start = clean(raw?.start,5); const end = clean(raw?.end,5);
  if (!HHMM.test(start) || !HHMM.test(end)) throw new Error(`${label} must use HH:MM start/end`);
  if (end <= start) throw new Error(`${label} end must be after start`);
  return Object.freeze({start,end});
}

function normalizeAvailability(input={}) {
  const timezone = clean(input.timezone,120);
  if (!timezone) throw new Error('workforce availability timezone is required');
  const weekly = {};
  const rawWeekly = input.weekly || input.weekly_availability || {};
  if (!rawWeekly || typeof rawWeekly !== 'object' || Array.isArray(rawWeekly)) throw new Error('weekly availability must be an object');
  for (const [day,value] of Object.entries(rawWeekly)) {
    if (!DAY_SET.has(day)) throw new Error(`unsupported availability day: ${day}`);
    const windows = Array.isArray(value) ? value.map((row,index)=>normalizeWindow(row,`${day}[${index}]`)) : [];
    for (let i=1;i<windows.length;i++) if (windows[i].start < windows[i-1].end) throw new Error(`${day} availability windows overlap`);
    weekly[day] = Object.freeze(windows);
  }
  for (const day of DAYS) if (!weekly[day]) weekly[day] = Object.freeze([]);
  return Object.freeze({
    timezone,
    weekly:Object.freeze(weekly),
    availability_is_planning_input_only:true,
    scheduling_execution_permitted:false,
    grants_authority:false,
  });
}

function normalizeEscalations(values,roleMap) {
  const rows = Array.isArray(values) ? values : [];
  if (!rows.length) throw new Error('at least one escalation default is required');
  return Object.freeze(rows.map((raw,index)=>{
    const severity = clean(raw?.severity,40).toLowerCase();
    if (!SEVERITIES.has(severity)) throw new Error(`unsupported escalation severity: ${severity || `<row-${index+1}>`}`);
    const targets = [...new Set((raw?.target_role_definition_ids || raw?.target_roles || []).map(x=>clean(x,180)).filter(Boolean))];
    if (!targets.length) throw new Error(`${severity} escalation requires at least one target role`);
    for (const id of targets) if (!roleMap.has(id)) throw new Error(`unknown escalation target role: ${id}`);
    const minutes = raw?.response_target_minutes == null ? null : Number(raw.response_target_minutes);
    if (minutes != null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)) throw new Error(`${severity}.response_target_minutes must be an integer from 1 to 10080`);
    return Object.freeze({
      severity,
      target_role_definition_ids:Object.freeze(targets.sort()),
      response_target_minutes:minutes,
      creates_escalation:false,
      auto_acknowledges:false,
      automatic_execution:false,
      grants_authority:false,
    });
  }));
}

export function createWorkforceSetupAuthority({ database, workforceCatalogue, clock=()=>Date.now() }={}) {
  if (!database?.getRecord || !database?.putRecord) throw new Error('business database is required');
  const roleMap = assertCatalogue(workforceCatalogue);
  const locator = () => ({module_id:'titan.onboarding',collection:'workforce-setup',record_id:'canonical'});

  async function read(contextInput) {
    rejectLegacy(contextInput,'context');
    const context = normalizeCompanyContext(contextInput || {});
    const prior = await database.getRecord(context,locator());
    const data = prior?.data || {};
    return Object.freeze({
      schema:'titan.onboarding.workforce-setup.view.v1',
      company_id:context.company_id,
      revision:Number(prior?.version || 0),
      available_roles:Object.freeze([...roleMap.values()]),
      role_selections:Object.freeze(clone(data.role_selections || [])),
      availability:clone(data.availability || null),
      escalation_defaults:Object.freeze(clone(data.escalation_defaults || [])),
      configuration_only:true,
      role_activation_permitted:false,
      worker_creation_permitted:false,
      scheduling_execution_permitted:false,
      escalation_execution_permitted:false,
      grants_authority:false,
      authority_granted:false,
      execution_permitted:false,
    });
  }

  async function save(contextInput,input={}) {
    rejectLegacy(contextInput,'context'); rejectLegacy(input,'workforce_setup');
    const context = normalizeCompanyContext(contextInput || {});
    if (input.company_id != null && clean(input.company_id,128) !== context.company_id) throw new Error('Cross-company workforce setup payload rejected');
    const role_selections = normalizeRoles(input.role_selections || input.roles,roleMap);
    const availability = normalizeAvailability(input.availability || {});
    const escalation_defaults = normalizeEscalations(input.escalation_defaults || input.escalations,roleMap);
    const selected = new Set(role_selections.filter(x=>x.enabled).map(x=>x.role_definition_id));
    for (const row of escalation_defaults) for (const id of row.target_role_definition_ids) {
      if (!selected.has(id)) throw new Error(`escalation target role must be enabled in onboarding workforce setup: ${id}`);
    }
    const prior = await database.getRecord(context,locator());
    const priorVersion = Number(prior?.version || 0);
    if (input.expected_revision != null && Number(input.expected_revision) !== priorVersion) throw new Error('workforce setup revision mismatch');
    const updated_at = Number(clock());
    const stored = await database.putRecord(context,{
      ...locator(),updated_at,
      data:{
        schema:'titan.onboarding.workforce-setup-record.v1',
        company_id:context.company_id,
        role_selections,
        availability,
        escalation_defaults,
        source_catalogue:'titan-workforce/catalogue/installed-client-workforce-master.json',
        configuration_only:true,
        role_activation_permitted:false,
        worker_creation_permitted:false,
        scheduling_execution_permitted:false,
        escalation_execution_permitted:false,
        grants_authority:false,
        authority_granted:false,
        execution_permitted:false,
        updated_at,
      },
      provenance:{
        source:'titan-onboarding-workforce-setup',
        consumes_existing_workforce_catalogue:true,
        copies_workforce_runtime:false,
        authority_runtime_unchanged:true,
      },
    });
    return Object.freeze({
      ok:true,
      company_id:context.company_id,
      revision:Number(stored.version || priorVersion+1),
      selected_role_definition_ids:Object.freeze(role_selections.filter(x=>x.enabled).map(x=>x.role_definition_id)),
      configuration_only:true,
      role_activation_permitted:false,
      worker_creation_permitted:false,
      execution_permitted:false,
      grants_authority:false,
      authority_granted:false,
    });
  }

  return Object.freeze({
    schema:'titan.onboarding.workforce-setup-authority.v1',
    company_boundary:'company_id',
    source_catalogue:'installed-client-workforce-master',
    configuration_only:true,
    role_activation_permitted:false,
    worker_creation_permitted:false,
    scheduling_execution_permitted:false,
    escalation_execution_permitted:false,
    grants_authority:false,
    read,save,
  });
}
