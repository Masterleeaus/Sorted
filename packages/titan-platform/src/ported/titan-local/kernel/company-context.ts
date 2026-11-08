// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-local/kernel/company-context.mjs
const COMPANY_RE=/^[A-Za-z0-9._:-]{2,128}$/;
const FORBIDDEN=new Set(['tenant_id','tenant_company_id']);
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

function assertNoLegacy(value,path='context'){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach((item,i)=>assertNoLegacy(item,`${path}[${i}]`));return;}
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN.has(key))throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is the only company boundary`);
    assertNoLegacy(child,`${path}.${key}`);
  }
}

export function normalizeCompanyContext(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Company context must be an object');
  assertNoLegacy(input);
  const company_id=String(input.company_id||'').trim();
  if(!COMPANY_RE.test(company_id))throw new Error('A valid company_id is required');
  const authority_grants=[...new Set((Array.isArray(input.authority_grants)?input.authority_grants:[]).map(v=>String(v||'').trim().toLowerCase()).filter(Boolean))];
  return Object.freeze({
    ...clone(input),company_id,
    actor_id:input.actor_id==null?null:String(input.actor_id).trim()||null,
    operation_id:input.operation_id==null?null:String(input.operation_id).trim()||null,
    idempotency_key:input.idempotency_key==null?null:String(input.idempotency_key).trim()||null,
    authority_grants,
  });
}

export function assertContractCompany(contractCompanyId,context){
  const scoped=contractCompanyId==null||contractCompanyId===''?null:String(contractCompanyId).trim();
  if(scoped&&scoped!==context.company_id)throw new Error(`Cross-company module access rejected: expected company_id ${scoped}`);
  return context.company_id;
}


// v12 startup-budget convergence: legacy company normalization lives in the already-loaded company context module.
const LEGACY_COMPANY_KEYS = Object.freeze(['tenant_id', 'tenant_company_id', 'workspace_tenant_id']);
const LEGACY_COMPANY_KEY_SET = new Set(LEGACY_COMPANY_KEYS);

const legacyClone = value => value == null ? value : globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function cleanCompanyId(value) {
  const companyId = value == null ? '' : String(value).trim();
  return companyId || null;
}

function resolveLegacyCompanyId(input, fallbackCompanyId = null, path = 'value') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return cleanCompanyId(fallbackCompanyId);
  const candidates = [];
  const canonical = cleanCompanyId(input.company_id);
  if (canonical) candidates.push({ key: 'company_id', value: canonical });
  for (const key of LEGACY_COMPANY_KEYS) {
    const value = cleanCompanyId(input[key]);
    if (value) candidates.push({ key, value });
  }
  const fallback = cleanCompanyId(fallbackCompanyId);
  if (fallback) candidates.push({ key: 'fallback_company_id', value: fallback });
  const unique = [...new Set(candidates.map(candidate => candidate.value))];
  if (unique.length > 1) {
    throw new Error(`Conflicting company boundary at ${path}: ${candidates.map(candidate => `${candidate.key}=${candidate.value}`).join(', ')}`);
  }
  return unique[0] || null;
}

export function normalizeLegacyCompanyContext(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Company context must be an object');
  const companyId = resolveLegacyCompanyId(input, null, 'context');
  if (!companyId) throw new Error('A valid company_id or legacy tenant company identifier is required');
  const normalized = legacyClone(input);
  for (const key of LEGACY_COMPANY_KEYS) delete normalized[key];
  normalized.company_id = companyId;
  return normalized;
}

export function normalizeLegacyCompanyPayload(value, companyId, path = 'value') {
  const canonicalCompanyId = cleanCompanyId(companyId);
  if (!canonicalCompanyId) throw new Error('company_id is required for legacy payload normalization');
  if (value == null || typeof value !== 'object') return legacyClone(value);
  if (Array.isArray(value)) return value.map((item, index) => normalizeLegacyCompanyPayload(item, canonicalCompanyId, `${path}[${index}]`));

  const resolved = resolveLegacyCompanyId(value, null, path);
  if (resolved && resolved !== canonicalCompanyId) throw new Error(`Cross-company legacy payload rejected at ${path}`);

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (LEGACY_COMPANY_KEY_SET.has(key)) continue;
    if (key === 'company_id') {
      out.company_id = canonicalCompanyId;
      continue;
    }
    out[key] = normalizeLegacyCompanyPayload(child, canonicalCompanyId, `${path}.${key}`);
  }
  if (resolved && !Object.prototype.hasOwnProperty.call(out, 'company_id')) out.company_id = canonicalCompanyId;
  return out;
}

export { LEGACY_COMPANY_KEYS };

