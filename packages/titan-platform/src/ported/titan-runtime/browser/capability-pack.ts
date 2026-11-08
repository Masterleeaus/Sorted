// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/browser/capability-pack.mjs
const LEGACY_KEYS = new Set(['tenant_id','tenant_company_id','tenant_company','tenant','tenantCompanyId','organisation_id','organization_id']);
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
const req = (v,n) => { const s=String(v??'').trim(); if(!s) throw new Error(`${n}-required`); return s; };
function rejectLegacy(v,path='pack'){ if(!v||typeof v!=='object') return; if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;} for(const [k,x] of Object.entries(v)){ if(LEGACY_KEYS.has(k)) throw new Error(`legacy-company-boundary:${path}.${k}`); rejectLegacy(x,`${path}.${k}`);} }
export function normalizeBrowserCapabilityPack(raw,{company_id}={}){
  rejectLegacy(raw); const cid=req(raw?.company_id??company_id,'company_id');
  if(company_id && cid!==company_id) throw new Error('cross-company-capability-pack');
  const capabilities=[...new Set((raw.capabilities||[]).map(x=>String(x).trim()).filter(Boolean))];
  return Object.freeze({schema:'titan.browser-capability-pack.v1',company_id:cid,id:req(raw.id,'id'),provider_id:req(raw.provider_id??'titan.native','provider_id'),capabilities:Object.freeze(capabilities),site_patterns:Object.freeze([...(raw.site_patterns||[])]),metadata:Object.freeze(clone(raw.metadata||{})),authority_neutral:true,activation_confers_authority:false});
}
export function contributionFromBrowserPack(pack){
  const p=normalizeBrowserCapabilityPack(pack,{company_id:pack.company_id});
  return Object.freeze({company_id:p.company_id,kind:'adapter',id:`browser.pack.${p.id}`,provider_id:p.provider_id,capabilities:p.capabilities,operations:['discover','inspect','propose'],offline_support:false,metadata:{site_patterns:p.site_patterns,source:'base-extensions-pattern-reimplementation'},payload:{pack_id:p.id},authority_neutral:true,activation_confers_authority:false});
}
