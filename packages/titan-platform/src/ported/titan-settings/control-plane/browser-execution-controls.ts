// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/browser-execution-controls.mjs
const EXTRACTION_SPEEDS = Object.freeze(['fast','balanced','thorough']);
const clamp=(n,min,max)=>Math.min(max,Math.max(min,Number.isFinite(Number(n))?Number(n):min));
const hasLegacyAlias=o=>JSON.stringify(o??{}).includes('tenant_id')||JSON.stringify(o??{}).includes('tenant_company_id');
export const BROWSER_EXECUTION_DEFAULTS=Object.freeze({
  max_parallel_tabs_cap:20,
  minimum_page_load_delay_ms:0,
  minimum_scroll_delay_ms:0,
  allowed_extraction_speeds:[...EXTRACTION_SPEEDS],
  allowed_network_modes:[],
  force_close_tabs_after_execution:false,
  remote_browser_allowed:true
});
export function projectBrowserExecutionControls({company_id,settings={}}={}){
  if(!company_id) throw new Error('company_id required');
  if(hasLegacyAlias(settings)) throw new Error('legacy company aliases are not accepted');
  const speeds=[...new Set((Array.isArray(settings.allowed_extraction_speeds)?settings.allowed_extraction_speeds:EXTRACTION_SPEEDS).filter(x=>EXTRACTION_SPEEDS.includes(x)))];
  return {
    company_id,
    max_parallel_tabs_cap:clamp(settings.max_parallel_tabs_cap??20,1,20),
    minimum_page_load_delay_ms:clamp(settings.minimum_page_load_delay_ms??0,0,60000),
    minimum_scroll_delay_ms:clamp(settings.minimum_scroll_delay_ms??0,0,60000),
    allowed_extraction_speeds:speeds.length?speeds:['balanced'],
    allowed_network_modes:[...new Set((Array.isArray(settings.allowed_network_modes)?settings.allowed_network_modes:[]).filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()))],
    force_close_tabs_after_execution:settings.force_close_tabs_after_execution===true,
    remote_browser_allowed:settings.remote_browser_allowed!==false,
    policy_projection_only:true,
    authority_granted:false,
    execution_permitted:false
  };
}
export function resolveBrowserExecutionControls({company_id,company_settings={},device_settings={},runtime={}}={}){
  const policy=projectBrowserExecutionControls({company_id,settings:company_settings});
  if(runtime.company_id && runtime.company_id!==company_id) throw new Error('runtime company mismatch');
  const runtimeNetworkModes=Array.isArray(runtime.allowed_network_modes)?runtime.allowed_network_modes.filter(x=>typeof x==='string'):[];
  let networkMode=typeof device_settings.networkToolExecutionMode==='string'?device_settings.networkToolExecutionMode:'auto';
  const policyNetworkModes=policy.allowed_network_modes.length?policy.allowed_network_modes:runtimeNetworkModes;
  if(policyNetworkModes.length && !policyNetworkModes.includes(networkMode)) networkMode=runtimeNetworkModes.includes('auto')?'auto':runtimeNetworkModes[0]??networkMode;
  let extractionSpeed=EXTRACTION_SPEEDS.includes(device_settings.extractionSpeed)?device_settings.extractionSpeed:'balanced';
  if(!policy.allowed_extraction_speeds.includes(extractionSpeed)) extractionSpeed=policy.allowed_extraction_speeds.includes('balanced')?'balanced':policy.allowed_extraction_speeds[0];
  const remoteRequested=Boolean(device_settings.remoteBrowserToolsConfig && Object.keys(device_settings.remoteBrowserToolsConfig).length);
  return {
    company_id,
    effective:{
      maxParallelTabs:Math.min(clamp(device_settings.maxParallelTabs??1,1,20),policy.max_parallel_tabs_cap),
      pageLoadDelay:Math.max(clamp(device_settings.pageLoadDelay??0,0,60000),policy.minimum_page_load_delay_ms),
      consecutiveScrollDelay:Math.max(clamp(device_settings.consecutiveScrollDelay??0,0,60000),policy.minimum_scroll_delay_ms),
      extractionSpeed,
      networkToolExecutionMode:networkMode,
      closeTabsAfterExecution:policy.force_close_tabs_after_execution?true:device_settings.closeTabsAfterExecution!==false,
      remoteBrowserAllowed:policy.remote_browser_allowed && runtime.remote_browser_available===true && runtime.external_execution_allowed===true && remoteRequested
    },
    constraints:{max_parallel_tabs:[1,20],delay_ms:[0,60000],extraction_speeds:[...EXTRACTION_SPEEDS]},
    runtime_revalidation_required:true,
    authority_granted:false,
    execution_permitted:false,
    settings_do_not_execute_browser_actions:true
  };
}
export {EXTRACTION_SPEEDS as BrowserExtractionSpeeds};
