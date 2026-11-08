// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/scheduled-intelligence/url-monitor.mjs
const MAX_TEXT = 120000;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 60 * 24 * 30;

function clean(value, max = 4000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}
function clampInterval(value) {
  const parsed = Number(value) || 60;
  return Math.max(MIN_INTERVAL_MINUTES, Math.min(MAX_INTERVAL_MINUTES, Math.round(parsed)));
}
function nowIso(now = Date.now) { return new Date(now()).toISOString(); }
function randomId(randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)) {
  return `monitor_${randomUUID ? randomUUID() : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;
}
function excerpt(text, needle) {
  const value = clean(text, MAX_TEXT);
  const query = clean(needle, 2000).toLowerCase();
  if (!query) return value;
  const index = value.toLowerCase().indexOf(query);
  if (index < 0) return value;
  return value.slice(Math.max(0, index - 4000), Math.min(value.length, index + query.length + 4000));
}
function requireCompanyId(input = {}) {
  const companyId = clean(input.company_id, 180);
  if (!companyId) throw new Error('company_id-required');
  return companyId;
}
function normalizeRecord(input = {}, existing = {}, deps = {}) {
  const company_id = requireCompanyId(input.company_id ? input : existing);
  const created_at = existing.created_at || nowIso(deps.now);
  const url = clean(input.url ?? existing.url, 5000);
  if (!/^https?:\/\//i.test(url)) throw new Error('monitor-url-required');
  return {
    id: clean(existing.id || input.id, 180) || randomId(deps.randomUUID),
    company_id,
    name: clean(input.name ?? existing.name, 1000) || 'URL monitor',
    url,
    match_text: clean(input.match_text ?? existing.match_text, 2000),
    interval_minutes: clampInterval(input.interval_minutes ?? existing.interval_minutes),
    enabled: input.enabled === undefined ? existing.enabled !== false : Boolean(input.enabled),
    baseline: clean(existing.baseline, MAX_TEXT),
    last_result: clean(existing.last_result, MAX_TEXT),
    last_run_at: clean(existing.last_run_at, 100),
    created_at,
    updated_at: nowIso(deps.now),
    local_monitor: true,
    authority_granted: false,
    execution_permitted: false,
  };
}

export function createTitanUrlMonitorRuntime(deps = {}) {
  const store = deps.store;
  const fetchFn = deps.fetchFn || globalThis.fetch;
  if (!store || typeof store.list !== 'function' || typeof store.put !== 'function' || typeof store.remove !== 'function') {
    throw new Error('scheduled-monitor-store-required');
  }
  if (typeof fetchFn !== 'function') throw new Error('fetch-unavailable');

  async function list(input = {}) {
    const company_id = requireCompanyId(input);
    const rows = await store.list(company_id);
    return rows.filter(row => row.company_id === company_id).sort((a,b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }
  async function create(input = {}) {
    const record = normalizeRecord(input, {}, deps);
    await store.put(record);
    return record;
  }
  async function update(input = {}) {
    const company_id = requireCompanyId(input);
    const existing = await store.get?.(company_id, clean(input.id,180));
    if (!existing || existing.company_id !== company_id) throw new Error('monitor-not-found');
    const record = normalizeRecord(input, existing, deps);
    await store.put(record);
    return record;
  }
  async function remove(input = {}) {
    const company_id = requireCompanyId(input);
    const id = clean(input.id, 180);
    if (!id) throw new Error('monitor-id-required');
    const removed = await store.remove(company_id, id);
    return { company_id, id, removed: Boolean(removed), authority_granted: false };
  }
  async function run(input = {}) {
    const company_id = requireCompanyId(input);
    const id = clean(input.id, 180);
    const record = await store.get?.(company_id, id);
    if (!record || record.company_id !== company_id) throw new Error('monitor-not-found');
    const response = await fetchFn(record.url, { cache: 'no-store', credentials: 'omit' });
    if (!response?.ok) throw new Error(`monitor-http-${response?.status || 'error'}`);
    const current = excerpt(await response.text(), record.match_text);
    const had_baseline = Boolean(record.baseline);
    const changed = had_baseline && current !== record.baseline;
    const ran_at = nowIso(deps.now);
    const next = { ...record, baseline: current, last_result: current, last_run_at: ran_at, updated_at: ran_at };
    await store.put(next);
    const receipt = {
      id,
      company_id,
      changed,
      current,
      previous: record.baseline,
      ran_at,
      local_monitor: true,
      provider_used: false,
      authority_granted: false,
      execution_permitted: false,
    };
    if (typeof store.appendReceipt === 'function') await store.appendReceipt(receipt);
    return receipt;
  }
  return { list, create, update, remove, run };
}
