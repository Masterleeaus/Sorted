// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/research-settings.mjs
const LEGACY_COMPANY_KEYS = new Set(['tenant_id','tenantId','tenant_company_id','tenantCompanyId']);

function assertCompany(company_id){
  if(typeof company_id!=='string'||!company_id.trim()) throw new Error('company_id is required');
  return company_id.trim();
}
function rejectLegacyAliases(value,path='settings'){
  if(!value||typeof value!=='object') return;
  if(Array.isArray(value)){ value.forEach((v,i)=>rejectLegacyAliases(v,`${path}[${i}]`)); return; }
  for(const [k,v] of Object.entries(value)){
    if(LEGACY_COMPANY_KEYS.has(k)) throw new Error(`legacy company alias not allowed at ${path}.${k}`);
    rejectLegacyAliases(v,`${path}.${k}`);
  }
}
function bool(value,fallback){ return typeof value==='boolean'?value:fallback; }

export const RESEARCH_SETTINGS_DEFAULTS = Object.freeze({
  web_search_allowed:true,
  cloud_scrape_allowed:false,
  enrichment_allowed:false,
  require_confirmation_for_paid_research:true,
  prefer_local_or_cached_sources:true,
  require_citations_when_available:true
});

export function projectResearchSettings({company_id,settings={}}={}){
  assertCompany(company_id); rejectLegacyAliases(settings);
  return Object.freeze({
    web_search_allowed:bool(settings.web_search_allowed,RESEARCH_SETTINGS_DEFAULTS.web_search_allowed),
    cloud_scrape_allowed:bool(settings.cloud_scrape_allowed,RESEARCH_SETTINGS_DEFAULTS.cloud_scrape_allowed),
    enrichment_allowed:bool(settings.enrichment_allowed,RESEARCH_SETTINGS_DEFAULTS.enrichment_allowed),
    require_confirmation_for_paid_research:bool(settings.require_confirmation_for_paid_research,RESEARCH_SETTINGS_DEFAULTS.require_confirmation_for_paid_research),
    prefer_local_or_cached_sources:bool(settings.prefer_local_or_cached_sources,RESEARCH_SETTINGS_DEFAULTS.prefer_local_or_cached_sources),
    require_citations_when_available:bool(settings.require_citations_when_available,RESEARCH_SETTINGS_DEFAULTS.require_citations_when_available)
  });
}

export function resolveResearchSettings({company_id,company_settings={},device_settings={},runtime={},tool_permissions={},cost={}}={}){
  assertCompany(company_id); rejectLegacyAliases(company_settings); rejectLegacyAliases(device_settings); rejectLegacyAliases(runtime); rejectLegacyAliases(tool_permissions); rejectLegacyAliases(cost);
  const policy=projectResearchSettings({company_id,settings:company_settings});
  const device={
    webSearchEnabled:bool(device_settings.webSearchEnabled,true),
    cloudScrapeEnabled:bool(device_settings.cloudScrapeEnabled,false),
    enrichEnabled:bool(device_settings.enrichEnabled,false)
  };
  const available={
    web_search:bool(runtime.web_search_available,true),
    cloud_scrape:bool(runtime.cloud_scrape_available,true),
    enrichment:bool(runtime.enrichment_available,true)
  };
  const permitted={
    web_search:bool(tool_permissions.web_search,true),
    cloud_scrape:bool(tool_permissions.cloud_scrape,true),
    enrichment:bool(tool_permissions.enrichment,true)
  };
  const costAllowed={
    web_search:bool(cost.web_search,true),
    cloud_scrape:bool(cost.cloud_scrape,true),
    enrichment:bool(cost.enrichment,true)
  };
  const effective={
    webSearchEnabled:policy.web_search_allowed&&device.webSearchEnabled&&available.web_search&&permitted.web_search&&costAllowed.web_search,
    cloudScrapeEnabled:policy.cloud_scrape_allowed&&device.cloudScrapeEnabled&&available.cloud_scrape&&permitted.cloud_scrape&&costAllowed.cloud_scrape,
    enrichEnabled:policy.enrichment_allowed&&device.enrichEnabled&&available.enrichment&&permitted.enrichment&&costAllowed.enrichment
  };
  return Object.freeze({
    company_id,
    policy,
    effective:Object.freeze(effective),
    governance:Object.freeze({
      resource_kind:'RESEARCH_REQUESTS',
      paid_research_confirmation_required:policy.require_confirmation_for_paid_research,
      prefer_local_or_cached_sources:policy.prefer_local_or_cached_sources,
      require_citations_when_available:policy.require_citations_when_available,
      device_preferences_are_contractive:true,
      tool_permission_gate_required:true,
      cost_gate_required:true,
      runtime_availability_gate_required:true
    }),
    authority_granted:false,
    execution_permitted:false
  });
}
