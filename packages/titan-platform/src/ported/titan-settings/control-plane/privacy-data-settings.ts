// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/privacy-data-settings.mjs
const LEGACY_COMPANY_KEYS=new Set(['tenant_id','tenantId','tenant_company_id','tenantCompanyId']);
function assertCompany(v){if(typeof v!=='string'||!v.trim())throw new Error('company_id is required');return v.trim()}
function rejectLegacyAliases(value,path='settings'){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach((v,i)=>rejectLegacyAliases(v,`${path}[${i}]`));return}for(const [k,v] of Object.entries(value)){if(LEGACY_COMPANY_KEYS.has(k))throw new Error(`legacy company alias not allowed at ${path}.${k}`);rejectLegacyAliases(v,`${path}.${k}`)}}
function bool(v,f){return typeof v==='boolean'?v:f}

export const PRIVACY_DATA_SETTINGS_DEFAULTS=Object.freeze({
  prefer_local_processing:true,
  cloud_processing_allowed:false,
  sensitive_data_cloud_allowed:false,
  require_data_minimisation:true,
  require_export_approval:true,
  require_sensitive_export_redaction:true,
  automatic_deletion:false,
  preserve_audit_authority_history:true
});

export function projectPrivacyDataSettings({company_id,settings={}}={}){
  assertCompany(company_id);rejectLegacyAliases(settings);
  return Object.freeze({
    prefer_local_processing:bool(settings.prefer_local_processing,PRIVACY_DATA_SETTINGS_DEFAULTS.prefer_local_processing),
    cloud_processing_allowed:bool(settings.cloud_processing_allowed,PRIVACY_DATA_SETTINGS_DEFAULTS.cloud_processing_allowed),
    sensitive_data_cloud_allowed:bool(settings.sensitive_data_cloud_allowed,PRIVACY_DATA_SETTINGS_DEFAULTS.sensitive_data_cloud_allowed),
    require_data_minimisation:true,
    require_export_approval:true,
    require_sensitive_export_redaction:true,
    automatic_deletion:false,
    preserve_audit_authority_history:true
  });
}

export function resolvePrivacyDataSettings({company_id,company_settings={},device_settings={},runtime={}}={}){
  assertCompany(company_id);rejectLegacyAliases(company_settings);rejectLegacyAliases(device_settings);rejectLegacyAliases(runtime);
  const policy=projectPrivacyDataSettings({company_id,settings:company_settings});
  const privateMode=bool(device_settings.privateMode,false);
  const cloudAvailable=bool(runtime.cloud_available,false);
  const sensitiveCloudAvailable=bool(runtime.sensitive_cloud_available,false);
  const cloudAllowed=policy.cloud_processing_allowed&&!privateMode&&cloudAvailable;
  const sensitiveCloudAllowed=cloudAllowed&&policy.sensitive_data_cloud_allowed&&sensitiveCloudAvailable;
  return Object.freeze({
    company_id,
    policy,
    device:Object.freeze({privateMode}),
    effective:Object.freeze({
      prefer_local_processing:policy.prefer_local_processing||privateMode,
      cloud_processing_allowed:cloudAllowed,
      sensitive_data_cloud_allowed:sensitiveCloudAllowed,
      require_data_minimisation:true,
      export_default:'DENY',
      require_export_approval:true,
      require_sensitive_export_redaction:true,
      automatic_deletion:false,
      preserve_audit_authority_history:true,
      protected_history_mode:'TOMBSTONE_OR_REDACT',
      automatic_secondary_use:false
    }),
    governance:Object.freeze({
      private_mode_forces_cloud_off:true,
      runtime_cloud_gate_required:true,
      sensitive_cloud_requires_separate_runtime_gate:true,
      workforce_privacy_runtime_remains_authoritative:true,
      retention_disposition_is_governed:true,
      exports_are_runtime_actions_not_settings_actions:true,
      deletion_is_runtime_governed_not_settings_driven:true
    }),
    automatic_export:false,
    automatic_deletion:false,
    authority_granted:false,
    execution_permitted:false
  });
}
