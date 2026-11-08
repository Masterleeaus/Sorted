import { normalizeCompanyContext } from '@titan-zero/storage/company-context';

const LEGACY_KEYS = new Set(['tenant_id','tenant_company_id','workspace_tenant_id']);
const clone = value => value == null ? value : (globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
const clean = value => String(value ?? '').trim();

function rejectLegacy(value, path='input') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((v,i)=>rejectLegacy(v,`${path}[${i}]`));
  for (const [key, child] of Object.entries(value)) {
    if (LEGACY_KEYS.has(key)) throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is the only company boundary`);
    rejectLegacy(child, `${path}.${key}`);
  }
}

function money(value, label) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a non-negative number`);
  return Math.round(n * 100) / 100;
}

export function resolveCanonicalCleaningJobTypes(bundle) {
  if (!bundle || typeof bundle !== 'object') throw new Error('cleaning workforce bundle is required');
  const module = (bundle.modules || []).find(item => item?.id === 'titan.workforce.cleaning');
  if (!module) throw new Error('titan.workforce.cleaning module is required');
  const projection = (module.contributes?.projections || []).find(item => item?.id === 'job-types');
  if (!projection || !Array.isArray(projection.value) || !projection.value.length) throw new Error('canonical cleaning job-types projection is required');
  const seen = new Set();
  return Object.freeze(projection.value.map(raw => {
    const id = clean(raw?.id);
    const label = clean(raw?.label);
    if (!id || !label || seen.has(id)) throw new Error('canonical cleaning job type ids must be unique and named');
    seen.add(id);
    const checklist = Array.isArray(raw.checklist) ? raw.checklist.map(clean).filter(Boolean) : [];
    if (!checklist.length) throw new Error(`canonical cleaning job type ${id} requires checklist items`);
    return Object.freeze({ id, label, checklist:Object.freeze(checklist), requiredEvidence:Object.freeze((raw.requiredEvidence || []).map(clean).filter(Boolean)) });
  }));
}

function normalizeSelection(input, byId) {
  const job_type_id = clean(input?.job_type_id || input?.id);
  const canonical = byId.get(job_type_id);
  if (!canonical) throw new Error(`unknown cleaning job type: ${job_type_id || '<empty>'}`);
  const pricing = input?.pricing || {};
  const mode = clean(pricing.mode || 'fixed').toLowerCase();
  if (!['fixed','hourly','quote_required'].includes(mode)) throw new Error(`unsupported pricing mode for ${job_type_id}`);
  const fixed_price = money(pricing.fixed_price, `${job_type_id}.fixed_price`);
  const hourly_rate = money(pricing.hourly_rate, `${job_type_id}.hourly_rate`);
  const minimum_charge = money(pricing.minimum_charge, `${job_type_id}.minimum_charge`);
  if (mode === 'fixed' && fixed_price == null) throw new Error(`${job_type_id}.fixed_price is required for fixed pricing`);
  if (mode === 'hourly' && hourly_rate == null) throw new Error(`${job_type_id}.hourly_rate is required for hourly pricing`);
  const checklist_selection = input?.checklist_selection == null
    ? canonical.checklist.map((_x,index)=>index)
    : [...new Set((Array.isArray(input.checklist_selection) ? input.checklist_selection : []).map(Number))];
  if (!checklist_selection.length) throw new Error(`${job_type_id} must retain at least one canonical checklist item`);
  for (const index of checklist_selection) {
    if (!Number.isInteger(index) || index < 0 || index >= canonical.checklist.length) throw new Error(`${job_type_id} checklist selection is outside canonical checklist`);
  }
  const sortedChecklist = [...checklist_selection].sort((a,b)=>a-b);
  return Object.freeze({
    job_type_id,
    service_label: clean(input?.service_label || canonical.label),
    enabled: input?.enabled !== false,
    pricing: Object.freeze({ mode, fixed_price, hourly_rate, minimum_charge, currency: clean(pricing.currency || 'AUD').toUpperCase() }),
    checklist_selection: Object.freeze(sortedChecklist),
    checklist_items: Object.freeze(sortedChecklist.map(index => canonical.checklist[index])),
    canonical_checklist_count: canonical.checklist.length,
    required_evidence: canonical.requiredEvidence,
    grants_authority: false,
  });
}

function normalizeRecurrence(input, byId, selectedJobTypeIds) {
  if (input == null) return Object.freeze({ enabled:false, supported_frequencies:Object.freeze([]), default_frequency:null, supported_job_type_ids:Object.freeze([]) });
  if (typeof input.enabled !== 'boolean') throw new Error('cleaning recurrence enabled must be a boolean');
  const allowedFrequencies = new Set(['weekly','fortnightly','monthly','custom_recurring']);
  if (input.supported_frequencies != null && !Array.isArray(input.supported_frequencies)) throw new Error('supported cleaning recurrence frequencies must be an array');
  const rawFrequencies = Array.isArray(input.supported_frequencies) ? input.supported_frequencies : [];
  const supported_frequencies = [...new Set(rawFrequencies.map(clean))];
  for (const frequency of supported_frequencies) if (!allowedFrequencies.has(frequency)) throw new Error(`unsupported cleaning recurrence frequency: ${frequency || '<empty>'}`);
  const default_frequency = input.default_frequency == null || clean(input.default_frequency) === '' ? null : clean(input.default_frequency);
  if (default_frequency && !supported_frequencies.includes(default_frequency)) throw new Error('default recurring frequency must be enabled');
  if (input.supported_job_type_ids != null && !Array.isArray(input.supported_job_type_ids)) throw new Error('recurring cleaning job type ids must be an array');
  const rawJobTypeIds = Array.isArray(input.supported_job_type_ids) ? input.supported_job_type_ids : [];
  const supported_job_type_ids = [...new Set(rawJobTypeIds.map(clean))];
  for (const id of supported_job_type_ids) {
    if (!byId.has(id)) throw new Error(`unknown recurring cleaning job type: ${id || '<empty>'}`);
    if (!selectedJobTypeIds.has(id)) throw new Error(`recurring cleaning job type ${id} is not selected`);
  }
  if (input.enabled && !supported_frequencies.length) throw new Error('recurring enabled but no supported recurring frequencies are configured');
  if (input.enabled && !supported_job_type_ids.length) throw new Error('recurring enabled but no selected job type supports recurrence');
  return Object.freeze({ enabled:input.enabled, supported_frequencies:Object.freeze(supported_frequencies), default_frequency, supported_job_type_ids:Object.freeze(supported_job_type_ids) });
}

export function createCleaningServiceSetupAuthority({ database, cleaningBundle, clock = () => Date.now() } = {}) {
  if (!database?.getRecord || !database?.putRecord) throw new Error('business database is required');
  const jobTypes = resolveCanonicalCleaningJobTypes(cleaningBundle);
  const byId = new Map(jobTypes.map(item => [item.id,item]));
  const locator = () => ({ module_id:'titan.onboarding', collection:'cleaning-service-setup', record_id:'canonical' });

  async function read(contextInput) {
    rejectLegacy(contextInput, 'context');
    const context = normalizeCompanyContext(contextInput || {});
    const prior = await database.getRecord(context, locator());
    const data = prior?.data || {};
    return Object.freeze({
      schema:'titan.onboarding.cleaning-service-setup.view.v1',
      company_id:context.company_id,
      revision:Number(prior?.version || 0),
      canonical_job_types:jobTypes,
      selections:Object.freeze(clone(data.selections || [])),
      recurrence:Object.freeze(clone(data.recurrence || { enabled:false, supported_frequencies:[], default_frequency:null, supported_job_type_ids:[] })),
      grants_authority:false,
      authority_granted:false,
      execution_permitted:false,
    });
  }

  async function save(contextInput, input={}) {
    rejectLegacy(contextInput, 'context'); rejectLegacy(input, 'cleaning_service_setup');
    const context = normalizeCompanyContext(contextInput || {});
    if (input.company_id != null && clean(input.company_id) !== context.company_id) throw new Error('Cross-company cleaning setup payload rejected');
    const raw = Array.isArray(input.selections) ? input.selections : [];
    if (!raw.length) throw new Error('at least one cleaning service selection is required');
    const normalized = raw.map(item => normalizeSelection(item, byId));
    if (new Set(normalized.map(item=>item.job_type_id)).size !== normalized.length) throw new Error('duplicate cleaning job type selection');
    const prior = await database.getRecord(context, locator());
    const priorVersion = Number(prior?.version || 0);
    const recurrenceInput = Object.prototype.hasOwnProperty.call(input,'recurrence')
      ? input.recurrence
      : prior?.data?.recurrence || { enabled:false, supported_frequencies:[], default_frequency:null, supported_job_type_ids:[] };
    const recurrence = normalizeRecurrence(recurrenceInput, byId, new Set(normalized.map(item=>item.job_type_id)));
    if (input.expected_revision != null && Number(input.expected_revision) !== priorVersion) throw new Error('cleaning setup revision mismatch');
    const updated_at = Number(clock());
    const stored = await database.putRecord(context, {
      ...locator(), updated_at,
      data:{ schema:'titan.onboarding.cleaning-service-setup-record.v1', company_id:context.company_id, selections:normalized, recurrence, source_module:'titan.workforce.cleaning', source_projection:'job-types', grants_authority:false, authority_granted:false, execution_permitted:false, updated_at },
      provenance:{ source:'titan-onboarding-cleaning-service-setup', canonical_module:'titan.workforce.cleaning', copied_catalogue:false }
    });
    return Object.freeze({ ok:true, company_id:context.company_id, revision:Number(stored.version || priorVersion+1), selected_job_types:Object.freeze(normalized.map(x=>x.job_type_id)), grants_authority:false, authority_granted:false, execution_permitted:false });
  }

  return Object.freeze({ schema:'titan.onboarding.cleaning-service-setup-authority.v1', company_boundary:'company_id', source_module:'titan.workforce.cleaning', source_projection:'job-types', grants_authority:false, read, save });
}
