// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/offline-synchronisation-settings.mjs
const LEGACY_COMPANY_KEYS=new Set(['tenant_id','tenantId','tenant_company_id','tenantCompanyId','workspace_tenant_id']);
const REAL_SYNC_MODES=new Set(['realtime','polling']);
function company(v){if(typeof v!=='string'||!v.trim())throw new Error('company_id is required');return v.trim()}
function rejectLegacy(value,path='settings'){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach((v,i)=>rejectLegacy(v,`${path}[${i}]`));return}for(const [k,v] of Object.entries(value)){if(LEGACY_COMPANY_KEYS.has(k))throw new Error(`legacy company alias not allowed at ${path}.${k}`);rejectLegacy(v,`${path}.${k}`)}}
const bool=(v,f)=>typeof v==='boolean'?v:f;
const integer=(v,f,min=0,max=100000)=>Number.isInteger(Number(v))?Math.max(min,Math.min(max,Number(v))):f;
function modes(v){const src=Array.isArray(v)?v:['realtime','polling'];const out=[];for(const m of src){const x=String(m||'').trim();if(REAL_SYNC_MODES.has(x)&&!out.includes(x))out.push(x)}return out.length?out:['realtime','polling']}

export const OFFLINE_SYNCHRONISATION_SETTINGS_DEFAULTS=Object.freeze({
  offline_first:true,
  sync_allowed:true,
  allowed_sync_modes:Object.freeze(['realtime','polling']),
  cached_reads_allowed:true,
  prepared_intents_retained:true,
  max_retry_attempts:5,
  minimum_retry_delay_ms:1000,
  maximum_retry_delay_ms:60000,
  conflict_resolution:'manual-review',
  require_explicit_resume:true,
  fresh_authority_after_reconnect:true,
  automatic_effect_replay:false
});

export function projectOfflineSynchronisationSettings({company_id,settings={}}={}){
  company(company_id);rejectLegacy(settings);
  const minDelay=integer(settings.minimum_retry_delay_ms,1000,0,86400000);
  const maxDelay=Math.max(minDelay,integer(settings.maximum_retry_delay_ms,60000,1000,86400000));
  return Object.freeze({
    offline_first:bool(settings.offline_first,true),
    sync_allowed:bool(settings.sync_allowed,true),
    allowed_sync_modes:Object.freeze(modes(settings.allowed_sync_modes)),
    cached_reads_allowed:bool(settings.cached_reads_allowed,true),
    prepared_intents_retained:bool(settings.prepared_intents_retained,true),
    max_retry_attempts:integer(settings.max_retry_attempts,5,0,10),
    minimum_retry_delay_ms:minDelay,
    maximum_retry_delay_ms:maxDelay,
    conflict_resolution:'manual-review',
    require_explicit_resume:true,
    fresh_authority_after_reconnect:true,
    automatic_effect_replay:false
  });
}

export function resolveOfflineSynchronisationSettings({company_id,company_settings={},runtime={}}={}){
  const companyId=company(company_id);rejectLegacy(company_settings);rejectLegacy(runtime);
  const policy=projectOfflineSynchronisationSettings({company_id:companyId,settings:company_settings});
  const requestedMode=String(runtime.requested_sync_mode||'').trim()||null;
  const runtimeRetryMax=integer(runtime.max_retry_attempts,5,0,10);
  const runtimeBaseDelay=integer(runtime.base_retry_delay_ms,1000,0,86400000);
  const runtimeMaxDelay=Math.max(runtimeBaseDelay,integer(runtime.max_retry_delay_ms,60000,1000,86400000));
  const syncAvailable=bool(runtime.sync_available,true);
  const syncModeAllowed=requestedMode?policy.allowed_sync_modes.includes(requestedMode):true;
  return Object.freeze({
    company_id:companyId,
    policy,
    effective:Object.freeze({
      offline_first:policy.offline_first,
      sync_allowed:policy.sync_allowed&&syncAvailable,
      requested_sync_mode:requestedMode,
      sync_mode_allowed:policy.sync_allowed&&syncAvailable&&syncModeAllowed,
      allowed_sync_modes:policy.allowed_sync_modes,
      cached_reads_allowed:policy.cached_reads_allowed,
      prepared_intents_retained:policy.prepared_intents_retained,
      max_retry_attempts:Math.min(policy.max_retry_attempts,runtimeRetryMax),
      base_retry_delay_ms:Math.max(policy.minimum_retry_delay_ms,runtimeBaseDelay),
      max_retry_delay_ms:Math.min(policy.maximum_retry_delay_ms,runtimeMaxDelay),
      conflict_resolution:'manual-review',
      conflict_requires_review:true,
      requires_explicit_resume:true,
      fresh_authority_after_reconnect:true,
      protected_command_offline_allowed:false,
      local_can_raise_authority:false,
      token_persisted:false,
      authority_decision_persisted:false,
      command_persisted:false,
      automatic_effect_replay:false,
      effect_replay_allowed:false
    }),
    state_ownership:Object.freeze({
      checkpoint_state_editable:false,
      projection_revision_editable:false,
      projection_cursor_editable:false,
      sync_generation_editable:false,
      retry_count_editable:false,
      execution_receipts_editable:false
    }),
    authority_granted:false,
    execution_permitted:false,
    automatic_resume:false,
    automatic_effect_replay:false
  });
}
