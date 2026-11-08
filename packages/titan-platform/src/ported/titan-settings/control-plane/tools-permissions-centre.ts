// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/tools-permissions-centre.mjs
const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
const LEGACY=new Set(['tenant_id','tenant_company_id','tenant_company','tenant','tenantCompanyId','organisation_id','organization_id','workspace_tenant_id']);
function rejectLegacy(v,path='tools-permissions-centre'){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}for(const[k,x]of Object.entries(v)){if(LEGACY.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(x,`${path}.${k}`);}}
function company(v){const id=clean(v,128);if(!/^[A-Za-z0-9._:-]{2,128}$/.test(id))throw new Error('tools-permissions-centre-company_id-required');return id;}
function uniq(v){return [...new Set((Array.isArray(v)?v:[]).map(x=>clean(x,120)).filter(Boolean))].sort();}
function registryMap(registry){if(!registry||registry.schema!=='titan-zero-tool-registry/v1'||!Array.isArray(registry.tools))throw new Error('tools-permissions-centre-tool-registry-required');const m=new Map();for(const t of registry.tools){if(!t?.tool_id)continue;m.set(String(t.tool_id),t);}return m;}
function bool(v,d=true){return typeof v==='boolean'?v:d;}
export const TOOLS_PERMISSIONS_CENTRE_DEFAULTS=Object.freeze({disabled_tools:Object.freeze([]),require_confirmation_for:Object.freeze([]),require_confirmation_for_authority_classes:Object.freeze(['protected_execution']),tool_overrides:Object.freeze({})});
export function projectToolsPermissionsCentre(input={}){
  rejectLegacy(input);const company_id=company(input.company_id);const raw=input.toolsPermissionsCentre||input.settings||{};rejectLegacy(raw);const map=registryMap(input.toolRegistry);const known=new Set(map.keys());
  const requestedDisabled=uniq(raw.disabled_tools);const requestedConfirm=uniq(raw.require_confirmation_for);const requestedClasses=uniq(raw.require_confirmation_for_authority_classes);
  const disabled_tools=requestedDisabled.filter(x=>known.has(x));const require_confirmation_for=requestedConfirm.filter(x=>known.has(x));
  const unknown=new Set([...requestedDisabled.filter(x=>!known.has(x)),...requestedConfirm.filter(x=>!known.has(x))]);
  const tool_overrides={};const contractions=[];
  for(const [toolId,ov] of Object.entries(raw.tool_overrides||{})){
    if(!known.has(toolId)){unknown.add(toolId);continue;}const def=map.get(toolId);const out={};
    if(ov?.enabled===false){if(!disabled_tools.includes(toolId))disabled_tools.push(toolId);out.enabled=false;}
    if(ov?.enabled===true)contractions.push(`${toolId}:settings-cannot-force-enable`);
    if(Array.isArray(ov?.allowed_roles)){const requested=uniq(ov.allowed_roles);const supported=new Set(def.supported_roles||[]);const narrowed=requested.filter(r=>supported.has(r));if(narrowed.length!==requested.length)contractions.push(`${toolId}:roles-cannot-expand-registry-support`);out.allowed_roles=narrowed;}
    if(ov?.require_confirmation===true){if(!require_confirmation_for.includes(toolId))require_confirmation_for.push(toolId);out.require_confirmation=true;}
    if(ov?.require_confirmation===false)contractions.push(`${toolId}:runtime-confirmation-cannot-be-disabled`);
    if(ov?.autonomy_ceiling!=null)contractions.push(`${toolId}:settings-cannot-raise-autonomy-ceiling`);
    tool_overrides[toolId]=out;
  }
  const tool_constraints=Object.fromEntries([...map.entries()].map(([id,t])=>[id,{supported_roles:[...(t.supported_roles||[])],authority_class:t.authority_class??null,autonomy_ceiling:t.autonomy_ceiling??null,grants_execution_authority:t.grants_execution_authority===true}]));
  return {schema:'titan.settings.tools-permissions-centre.v1',company_id,disabled_tools:[...new Set(disabled_tools)].sort(),require_confirmation_for:[...new Set(require_confirmation_for)].sort(),require_confirmation_for_authority_classes:requestedClasses.length?requestedClasses:['protected_execution'],tool_overrides,unknown_tool_ids:[...unknown].sort(),contractions:[...new Set(contractions)].sort(),canonical_tool_ids:[...known].sort(),tool_constraints,tool_registry_owner:'titan-tools/TOOL-REGISTRY.json',runtime_owners:['titan-tools/tool-registry.js','titan-runtime/authority/execution-boundary.js'],settings_can_force_enable:false,settings_can_expand_roles:false,settings_can_raise_autonomy:false,settings_can_bypass_entitlement:false,settings_can_bypass_cost_policy:false,settings_can_disable_runtime_confirmation:false,settings_can_grant_authority:false,settings_can_execute:false,execution_permitted:false,authority_granted:false,grants_authority:false};
}
export function resolveToolPermission(projection={},input={}){
  rejectLegacy(input);const company_id=company(projection.company_id);if(input.company_id&&clean(input.company_id,128)!==company_id)throw new Error('tools-permissions-centre-cross-company-resolution');const tool_id=clean(input.tool_id,120);if(!tool_id)throw new Error('tools-permissions-centre-tool_id-required');if(!Array.isArray(projection.canonical_tool_ids)||!projection.canonical_tool_ids.includes(tool_id))throw new Error(`unknown-tool:${tool_id}`);
  const registry=input.toolRegistry;let def=input.tool_definition||null;if(!def&&registry){def=registryMap(registry).get(tool_id)||null;}if(!def&&input.registry_tools){def=(input.registry_tools||[]).find(x=>x.tool_id===tool_id)||null;}if(!def&&projection.tool_constraints)def=projection.tool_constraints[tool_id]||null;
  // Projection intentionally does not own tool definitions; callers may provide one, otherwise permission can only remain conservative.
  const blockers=[];const disabled=projection.disabled_tools?.includes(tool_id)===true;if(disabled)blockers.push('disabled-by-company-settings');
  if(input.runtime_available===false)blockers.push('runtime-unavailable');if(input.entitled===false)blockers.push('entitlement-required');if(input.cost_allowed===false)blockers.push('cost-policy-blocked');if(input.authority_allowed===false)blockers.push('runtime-authority-denied');
  const role=clean(input.role,80);if(def&&role&&!Array.isArray(def.supported_roles))blockers.push('role-support-unavailable');else if(def&&role&&!def.supported_roles.includes(role))blockers.push('role-not-supported-by-tool-registry');
  const override=projection.tool_overrides?.[tool_id]||{};if(Array.isArray(override.allowed_roles)&&override.allowed_roles.length&&role&&!override.allowed_roles.includes(role))blockers.push('role-disabled-by-company-settings');
  const authorityClass=clean(def?.authority_class??input.authority_class,100);const confirmation_required=input.runtime_requires_confirmation===true||projection.require_confirmation_for?.includes(tool_id)===true||(authorityClass&&projection.require_confirmation_for_authority_classes?.includes(authorityClass));
  return {schema:'titan.settings.tool-permission-resolution.v1',company_id,tool_id,role:role||null,allowed:blockers.length===0,blockers:[...new Set(blockers)].sort(),confirmation_required,authority_class:authorityClass||null,registry_autonomy_ceiling:def?.autonomy_ceiling??null,settings_can_force_enable:false,settings_can_expand_roles:false,settings_can_raise_autonomy:false,settings_can_bypass_entitlement:false,settings_can_bypass_cost_policy:false,settings_can_disable_runtime_confirmation:false,settings_can_grant_authority:false,settings_can_execute:false,execution_permitted:false,authority_granted:false,grants_authority:false,requires_runtime_revalidation:true};
}
