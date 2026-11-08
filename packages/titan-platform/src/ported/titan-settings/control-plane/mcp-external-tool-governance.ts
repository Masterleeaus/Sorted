// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/mcp-external-tool-governance.mjs
const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
const LEGACY=new Set(['tenant_id','tenant_company_id','tenant_company','tenant','tenantCompanyId','organisation_id','organization_id','workspace_tenant_id']);
function rejectLegacy(v,path='mcp-external-tool-governance'){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}for(const[k,x]of Object.entries(v)){if(LEGACY.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(x,`${path}.${k}`);}}
function company(v){const id=clean(v,128);if(!/^[A-Za-z0-9._:-]{2,128}$/.test(id))throw new Error('mcp-external-tool-governance-company_id-required');return id;}
function uniq(v){return [...new Set((Array.isArray(v)?v:[]).map(x=>clean(x,160)).filter(Boolean))].sort();}
export const MCP_EXTERNAL_TOOL_GOVERNANCE_DEFAULTS=Object.freeze({mcp_allowed:true,require_confirmation:true,remote_browser_allowed:false,disabled_external_tools:Object.freeze([]),require_confirmation_for:Object.freeze([])});
export function projectMcpExternalToolGovernance(input={}){
  rejectLegacy(input);const company_id=company(input.company_id);const raw=input.mcpExternalToolGovernance||input.settings||{};rejectLegacy(raw);
  const externalIds=new Set(uniq((input.externalToolCatalog||[]).map(x=>typeof x==='string'?x:x?.tool_id||x?.id)));
  const disabled=uniq(raw.disabled_external_tools).filter(x=>externalIds.has(x));const confirm=uniq(raw.require_confirmation_for).filter(x=>externalIds.has(x));
  const unknown=[...new Set([...uniq(raw.disabled_external_tools).filter(x=>!externalIds.has(x)),...uniq(raw.require_confirmation_for).filter(x=>!externalIds.has(x))])].sort();
  return {schema:'titan.settings.mcp-external-tool-governance.v1',company_id,mcp_allowed:raw.mcp_allowed!==false,require_confirmation:raw.require_confirmation!==false,remote_browser_allowed:raw.remote_browser_allowed===true,disabled_external_tools:disabled,require_confirmation_for:confirm,unknown_external_tool_ids:unknown,device_compatibility_keys:['mcpExecutionsEnabled','requireMcpConfirmation','remoteBrowserToolsConfig'],excluded_secret_keys:['mcpApiKey','mcpApiKeyId'],settings_can_store_mcp_secret:false,settings_can_create_connector:false,settings_can_force_connect:false,settings_can_force_enable_external_tool:false,settings_can_disable_runtime_confirmation:false,settings_can_bypass_tool_permissions:false,settings_can_bypass_entitlement:false,settings_can_bypass_cost_policy:false,settings_can_grant_authority:false,settings_can_execute:false,execution_permitted:false,authority_granted:false,grants_authority:false};
}
export function resolveMcpExternalToolGovernance(projection={},input={}){
  rejectLegacy(input);const company_id=company(projection.company_id);if(input.company_id&&clean(input.company_id,128)!==company_id)throw new Error('mcp-external-tool-governance-cross-company-resolution');
  const tool_id=clean(input.tool_id,160);const blockers=[];
  if(projection.mcp_allowed!==true)blockers.push('mcp-disabled-by-company-settings');
  if(input.device_mcp_executions_enabled!==true)blockers.push('mcp-disabled-on-device');
  if(input.runtime_mcp_available===false)blockers.push('mcp-runtime-unavailable');
  if(input.connector_connected===false)blockers.push('connector-not-connected');
  if(input.entitled===false)blockers.push('entitlement-required');
  if(input.cost_allowed===false)blockers.push('cost-policy-blocked');
  if(input.tool_permission_allowed===false)blockers.push('tool-permission-blocked');
  if(input.authority_allowed===false)blockers.push('runtime-authority-denied');
  if(tool_id&&projection.disabled_external_tools?.includes(tool_id))blockers.push('external-tool-disabled-by-company-settings');
  const confirmation_required=input.runtime_requires_confirmation===true||input.device_require_mcp_confirmation===true||projection.require_confirmation===true||(tool_id&&projection.require_confirmation_for?.includes(tool_id));
  const remote_browser_requested=input.remote_browser_requested===true;
  if(remote_browser_requested&&projection.remote_browser_allowed!==true)blockers.push('remote-browser-disabled-by-company-settings');
  if(remote_browser_requested&&input.remote_browser_runtime_available===false)blockers.push('remote-browser-runtime-unavailable');
  return {schema:'titan.settings.mcp-external-tool-resolution.v1',company_id,tool_id:tool_id||null,allowed:blockers.length===0,blockers:[...new Set(blockers)].sort(),confirmation_required,remote_browser_requested,secret_material_present:false,settings_can_store_mcp_secret:false,settings_can_force_connect:false,settings_can_force_enable_external_tool:false,settings_can_disable_runtime_confirmation:false,settings_can_bypass_tool_permissions:false,settings_can_bypass_entitlement:false,settings_can_bypass_cost_policy:false,settings_can_grant_authority:false,settings_can_execute:false,execution_permitted:false,authority_granted:false,grants_authority:false,requires_runtime_revalidation:true};
}
