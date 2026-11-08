// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/autonomy-settings-centre.mjs
const LEGACY_ALIASES=['tenant_id','tenant_company_id'];
export const AUTONOMY_LEVELS=Object.freeze(['suggest','assist','semi_auto','auto','trusted_auto','predictive']);
export const AUTONOMY_BANDS=Object.freeze({suggest:[0,15],assist:[16,30],semi_auto:[31,50],auto:[51,70],trusted_auto:[71,85],predictive:[86,100]});
const RISK_LEVELS=Object.freeze(['low','medium','high']);
function company(input){
  if(!input||typeof input!=='object') throw new Error('autonomy-settings-input-required');
  for(const k of LEGACY_ALIASES) if(k in input) throw new Error(`legacy-company-boundary-alias-forbidden:${k}`);
  const id=String(input.company_id??'').trim(); if(!id) throw new Error('company_id-required'); return id;
}
function level(value,fallback='suggest'){
  const v=String(value??fallback).trim().toLowerCase().replaceAll('-','_');
  if(!AUTONOMY_LEVELS.includes(v)) throw new Error(`autonomy-level-invalid:${v}`); return v;
}
function levelMax(l){return AUTONOMY_BANDS[l][1]}
function levelForScore(v){const n=Math.max(0,Math.min(100,Math.floor(Number(v)||0)));return AUTONOMY_LEVELS.find(l=>n>=AUTONOMY_BANDS[l][0]&&n<=AUTONOMY_BANDS[l][1])??'suggest'}
function cleanOverrides(raw){
  if(raw==null) return Object.freeze({}); if(typeof raw!=='object'||Array.isArray(raw)) throw new Error('capability-overrides-invalid');
  const out={}; for(const [k,v] of Object.entries(raw)){const key=String(k).trim(); if(!key) continue; out[key]=level(v);} return Object.freeze(out);
}
export function projectAutonomySettingsCentre(input){
  const company_id=company(input); const s=input.settings&&typeof input.settings==='object'?input.settings:{};
  const raw=s.autonomySettingsCentre&&typeof s.autonomySettingsCentre==='object'?s.autonomySettingsCentre:{};
  const default_level=level(raw.default_level,'suggest');
  const rc=raw.risk_caps&&typeof raw.risk_caps==='object'?raw.risk_caps:{};
  const risk_caps=Object.freeze({low:level(rc.low,default_level),medium:level(rc.medium,default_level),high:level(rc.high,default_level)});
  return Object.freeze({schema_version:'1.0',company_id,default_level,risk_caps,capability_overrides:cleanOverrides(raw.capability_overrides),predictive_enabled:Boolean(raw.predictive_enabled),trusted_auto_requires_handshake:true,settings_can_grant_authority:false,grants_authority:false,execution_allowed:false});
}
export function buildAutonomyCapProjection(input){
  const company_id=company(input); const p=input.projected_settings;
  if(!p||p.company_id!==company_id) throw new Error('autonomy-settings-company-mismatch');
  const capability=String(input.capability??'').trim(); if(!capability) throw new Error('capability-required');
  const risk=String(input.risk??'medium').trim().toLowerCase(); if(!RISK_LEVELS.includes(risk)) throw new Error('risk-invalid');
  let requested_level=p.capability_overrides?.[capability]??p.default_level;
  if(requested_level==='predictive'&&!p.predictive_enabled) requested_level='trusted_auto';
  const risk_cap_level=p.risk_caps?.[risk]??p.default_level;
  const effective_settings_cap_level=levelMax(requested_level)<=levelMax(risk_cap_level)?requested_level:risk_cap_level;
  return Object.freeze({schema_version:'1.0',company_id,capability,risk,requested_level,risk_cap_level,effective_settings_cap_level,effective_settings_cap_score:levelMax(effective_settings_cap_level),predictive_enabled:p.predictive_enabled,can_raise_verified_authority:false,settings_grant_authority:false,execution_allowed:false});
}
export function evaluateAutonomyPreference(input){
  const company_id=company(input); const p=input.projection; const s=input.verified_snapshot;
  if(!p||p.company_id!==company_id||!s||String(s.company_id??'')!==company_id) throw new Error('autonomy-company-mismatch');
  const verified=Math.max(0,Math.min(100,Math.floor(Number(s.effective_score)||0)));
  let cap=Math.min(verified,Number(p.effective_settings_cap_score)); const reasons=[];
  if(cap<verified) reasons.push('settings_contracted_verified_authority');
  let band=levelForScore(cap);
  const hs=s.trusted_auto_handshake&&typeof s.trusted_auto_handshake==='object'?s.trusted_auto_handshake:{};
  const trustedComplete=Boolean(hs.platform&&hs.user&&hs.assurance);
  if((band==='trusted_auto'||band==='predictive')&&!trustedComplete){cap=Math.min(cap,AUTONOMY_BANDS.auto[1]);band=levelForScore(cap);reasons.push('trusted_auto_handshake_incomplete');}
  if(band==='predictive'&&(!p.predictive_enabled||!s.predictive_ready)){cap=Math.min(cap,AUTONOMY_BANDS.trusted_auto[1]);band=levelForScore(cap);reasons.push('predictive_runtime_not_ready');}
  return Object.freeze({schema_version:'1.0',company_id,capability:p.capability,verified_score:verified,settings_cap_score:p.effective_settings_cap_score,effective_score:cap,effective_level:band,reason_codes:Object.freeze(reasons),authority_increased:false,can_execute:false,requires_runtime_authority_revalidation:true});
}
