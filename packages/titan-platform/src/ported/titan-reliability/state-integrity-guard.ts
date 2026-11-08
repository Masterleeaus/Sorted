// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/state-integrity-guard.mjs
import { createHash } from 'node:crypto';

const clean = value => String(value ?? '').trim();
const arr = value => Array.isArray(value) ? value : [];

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

export function digestState(state) {
  return createHash('sha256').update(stable(state)).digest('hex');
}

export function verifyStateIntegrity({company_id,records=[]}={}) {
  const companyId=clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const corrupt=[];
  const missing=[];
  for (const record of arr(records)) {
    const recordCompany=clean(record?.company_id);
    if (recordCompany && recordCompany!==companyId) throw new Error('cross-company:state-integrity');
    const id=clean(record?.record_id) || 'unknown';
    const expected=clean(record?.expected_sha256).toLowerCase();
    if (!expected) { missing.push(id); continue; }
    if (digestState(record?.state)!==expected) corrupt.push(id);
  }
  return Object.freeze({
    schema:'titan.reliability.state-integrity-guard.v1',
    company_id:companyId,
    corrupt_ids:Object.freeze(corrupt),
    missing_hash_ids:Object.freeze(missing),
    safe_to_resume:corrupt.length===0 && missing.length===0,
    advisory_only:true,
    grants_authority:false,
    authority_effect:false,
  });
}
