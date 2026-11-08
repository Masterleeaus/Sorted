// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-onboarding/runtime/business-setup-authority.mjs
import { normalizeCompanyContext } from '../../titan-local/kernel/company-context.js';

const MODULE_ID = 'titan-onboarding';
const PROFILE_COLLECTION = 'business-profile';
const RECORD_ID = 'current';
const LEGACY_KEYS = new Set(['tenant_id', 'tenant_company_id', 'workspace_tenant_id']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAY_KEYS = Object.freeze(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']);

const clone = value => value == null ? value : globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function rejectLegacy(value, path = 'value') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((child, index) => rejectLegacy(child, `${path}[${index}]`));
  for (const [key, child] of Object.entries(value)) {
    if (LEGACY_KEYS.has(key)) throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is the only company boundary`);
    rejectLegacy(child, `${path}.${key}`);
  }
}

function cleanText(value, max = 240) {
  const out = value == null ? '' : String(value).trim();
  if (out.length > max) throw new Error(`value exceeds ${max} characters`);
  return out;
}

function normalizeIdentity(input = {}) {
  rejectLegacy(input, 'identity');
  const legal_name = cleanText(input.legal_name, 180);
  const trading_name = cleanText(input.trading_name, 180);
  if (!legal_name && !trading_name) throw new Error('business identity requires legal_name or trading_name');
  return Object.freeze({
    legal_name: legal_name || null,
    trading_name: trading_name || legal_name || null,
    abn: cleanText(input.abn, 32) || null,
    business_type: cleanText(input.business_type, 80) || null,
  });
}

function normalizeServiceAreas(input = []) {
  if (!Array.isArray(input)) throw new Error('service_areas must be an array');
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    rejectLegacy(raw, 'service_areas');
    const item = typeof raw === 'string' ? { label: raw } : raw;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('service area must be a string or object');
    const label = cleanText(item.label ?? item.name ?? item.postcode, 120);
    if (!label) throw new Error('service area label is required');
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(Object.freeze({
      label,
      postcode: cleanText(item.postcode, 16) || null,
      radius_km: item.radius_km == null ? null : Number(item.radius_km),
    }));
  }
  return Object.freeze(out);
}

function normalizeHours(input = {}) {
  rejectLegacy(input, 'operating_hours');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('operating_hours must be an object');
  const out = {};
  for (const day of DAY_KEYS) {
    const raw = input[day];
    if (raw == null) continue;
    if (raw === false || raw?.closed === true) { out[day] = Object.freeze({ closed: true }); continue; }
    const open = cleanText(raw?.open, 5);
    const close = cleanText(raw?.close, 5);
    if (!HHMM_RE.test(open) || !HHMM_RE.test(close)) throw new Error(`operating_hours.${day} requires HH:MM open/close`);
    if (open >= close) throw new Error(`operating_hours.${day} close must be after open`);
    out[day] = Object.freeze({ open, close, closed: false });
  }
  return Object.freeze(out);
}

function normalizeContact(input = {}) {
  rejectLegacy(input, 'contact');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('contact must be an object');
  const email = cleanText(input.email, 200);
  if (email && !EMAIL_RE.test(email)) throw new Error('contact.email is invalid');
  return Object.freeze({
    email: email || null,
    phone: cleanText(input.phone, 60) || null,
    website: cleanText(input.website, 240) || null,
    address: cleanText(input.address, 320) || null,
  });
}

function normalizeBusinessPreferences(input = {}) {
  rejectLegacy(input, 'business_preferences');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('business_preferences must be an object');
  const measurement = cleanText(input.measurement_system || 'metric', 16).toLowerCase();
  if (!['metric','imperial'].includes(measurement)) throw new Error('business_preferences.measurement_system must be metric or imperial');
  return Object.freeze({
    timezone: cleanText(input.timezone || 'Australia/Melbourne', 100),
    locale: cleanText(input.locale || 'en-AU', 32),
    currency: cleanText(input.currency || 'AUD', 8).toUpperCase(),
    measurement_system: measurement,
  });
}

function registryMap(registry) {
  return new Map((registry?.settings || []).filter(Boolean).map(entry => [String(entry.key), entry]));
}

function normalizePreferences(preferences = {}, registry) {
  rejectLegacy(preferences, 'preferences');
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) throw new Error('preferences must be an object');
  const map = registryMap(registry);
  const out = [];
  for (const [key, value] of Object.entries(preferences)) {
    const entry = map.get(key);
    if (!entry) throw new Error(`unknown setting key: ${key}`);
    if (entry.scope !== 'company') throw new Error(`onboarding may only write company-scoped preferences: ${key}`);
    if (entry.editable === false) throw new Error(`setting is not editable: ${key}`);
    if (entry.sensitivity === 'secret') throw new Error(`secret setting cannot be written by onboarding: ${key}`);
    out.push(Object.freeze({ key, value: clone(value), scope: entry.scope, owner: entry.owner, setting: entry }));
  }
  return Object.freeze(out);
}

function locator() {
  return { module_id: MODULE_ID, collection: PROFILE_COLLECTION, record_id: RECORD_ID };
}

export function createBusinessSetupAuthority({ database, settingsAdapter, settingsRegistry, clock = () => Date.now() } = {}) {
  if (!database || typeof database.getRecord !== 'function' || typeof database.putRecord !== 'function') throw new Error('Titan business database is required');
  if (!settingsAdapter || typeof settingsAdapter.read !== 'function' || typeof settingsAdapter.write !== 'function') throw new Error('Titan settings adapter is required');
  if (!settingsRegistry || !Array.isArray(settingsRegistry.settings)) throw new Error('Titan settings registry is required');

  const read = async contextInput => {
    const context = normalizeCompanyContext(contextInput || {});
    const record = await database.getRecord(context, locator());
    const data = record?.data || null;
    const preferences = {};
    for (const entry of data?.preference_keys || []) {
      const def = registryMap(settingsRegistry).get(entry);
      if (!def || def.scope !== 'company') continue;
      preferences[entry] = await settingsAdapter.read({ key: entry, scope: def.scope, context, owner: def.owner });
    }
    return Object.freeze({
      schema: 'titan.onboarding.business-setup.v1',
      company_id: context.company_id,
      revision: Number(record?.version || 0),
      identity: clone(data?.identity || null),
      service_areas: clone(data?.service_areas || []),
      operating_hours: clone(data?.operating_hours || {}),
      contact: clone(data?.contact || null),
      business_preferences: clone(data?.business_preferences || normalizeBusinessPreferences({})),
      preferences: Object.freeze(preferences),
      grants_authority: false,
      authority_granted: false,
      execution_permitted: false,
    });
  };

  const save = async (contextInput, input = {}) => {
    rejectLegacy(input, 'business_setup');
    const context = normalizeCompanyContext(contextInput || {});
    if (input.company_id != null && String(input.company_id).trim() !== context.company_id) throw new Error('Cross-company business setup payload rejected');
    const identity = normalizeIdentity(input.identity || {});
    const service_areas = normalizeServiceAreas(input.service_areas || []);
    const operating_hours = normalizeHours(input.operating_hours || {});
    const contact = normalizeContact(input.contact || input.contact_details || {});
    const business_preferences = normalizeBusinessPreferences(input.business_preferences || input.company_preferences || {});
    const preferenceWrites = normalizePreferences(input.preferences || {}, settingsRegistry);

    const prior = await database.getRecord(context, locator());
    const priorVersion = Number(prior?.version || 0);
    if (input.expected_revision != null && Number(input.expected_revision) !== priorVersion) throw new Error('business setup revision mismatch');

    for (const pref of preferenceWrites) {
      await settingsAdapter.write({ key: pref.key, value: pref.value, scope: pref.scope, context, owner: pref.owner, setting: pref.setting });
      const readBack = await settingsAdapter.read({ key: pref.key, scope: pref.scope, context, owner: pref.owner });
      if (JSON.stringify(readBack) !== JSON.stringify(pref.value)) throw new Error(`settings verification failed: ${pref.key}`);
    }

    const updated_at = Number(clock());
    const stored = await database.putRecord(context, {
      ...locator(),
      updated_at,
      data: {
        schema: 'titan.onboarding.business-profile-record.v1',
        company_id: context.company_id,
        identity,
        service_areas,
        operating_hours,
        contact,
        business_preferences,
        preference_keys: preferenceWrites.map(item => item.key).sort(),
        grants_authority: false,
        authority_granted: false,
        execution_permitted: false,
        updated_at,
      },
      provenance: { source: 'titan-onboarding-business-setup', compatibility: false },
    });

    return Object.freeze({
      ok: true,
      company_id: context.company_id,
      revision: Number(stored.version || priorVersion + 1),
      persisted_profile: true,
      persisted_preference_keys: Object.freeze(preferenceWrites.map(item => item.key).sort()),
      grants_authority: false,
      authority_granted: false,
      execution_permitted: false,
    });
  };

  return Object.freeze({
    schema: 'titan.onboarding.business-setup-authority.v1',
    company_boundary: 'company_id',
    grants_authority: false,
    read,
    save,
  });
}
