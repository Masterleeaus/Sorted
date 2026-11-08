// @ts-nocheck
// Ported from Titan Zero extension (portable-core): diagnostics/startup/deterministic-load-cycle-harness.mjs
const LEGACY_COMPANY_KEYS=new Set(['tenant_id','tenant_company_id','workspace_tenant_id']);
const REQUIRED_SURFACES=Object.freeze(['popup','side_panel','content_scripts','diagnostics','offline_startup']);
const VALID_LIFECYCLES=new Set(['load','reload','restart']);
const clone=value=>value==null?value:globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));

function rejectLegacy(value,path='input'){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach((child,index)=>rejectLegacy(child,`${path}[${index}]`));return;}
  for(const [key,child] of Object.entries(value)){
    if(LEGACY_COMPANY_KEYS.has(key))throw new Error(`legacy-company-boundary:${path}.${key}`);
    rejectLegacy(child,`${path}.${key}`);
  }
}
const clean=value=>String(value??'').trim();
const uniq=items=>[...new Set(items.filter(Boolean))];
const immutable=value=>Object.freeze(value);

export function buildDeterministicChromeLoadPlan({manifest={}}={}){
  rejectLegacy(manifest,'manifest');
  const popup=clean(manifest?.action?.default_popup);
  const sidePanel=clean(manifest?.side_panel?.default_path);
  const contentResources=[];
  for(const script of Array.isArray(manifest?.content_scripts)?manifest.content_scripts:[]){
    for(const js of Array.isArray(script?.js)?script.js:[])contentResources.push(clean(js));
    for(const css of Array.isArray(script?.css)?script.css:[])contentResources.push(clean(css));
  }
  const requiredResources=uniq([
    popup,
    'titan-popup.js',
    sidePanel,
    'side-panel/index.html',
    ...contentResources,
    'diagnostics.html',
    'diagnostics.js',
    'titan-offline/browser-restart-harness.js',
    'titan-runtime/page-context-rehydration.js',
  ]);
  return immutable({
    schema:'titan.chrome-load.deterministic-plan.v1',
    manifest_version:Number(manifest?.manifest_version||0),
    extension_version:clean(manifest?.version)||'unknown',
    service_worker:clean(manifest?.background?.service_worker)||null,
    required_surfaces:REQUIRED_SURFACES,
    required_resources:Object.freeze(requiredResources),
    surfaces:immutable({
      popup:immutable({entry:popup||null,required:Boolean(popup),lifecycle:Object.freeze(['load','reload'])}),
      side_panel:immutable({entry:sidePanel||null,required:Boolean(sidePanel),lifecycle:Object.freeze(['load','reload','restart'])}),
      content_scripts:immutable({resources:Object.freeze(uniq(contentResources)),required:contentResources.length>0,lifecycle:Object.freeze(['load','reload','restart'])}),
      diagnostics:immutable({entry:'diagnostics.html',script:'diagnostics.js',required:true,lifecycle:Object.freeze(['load','reload','restart'])}),
      offline_startup:immutable({entry:'titan-offline/browser-restart-harness.js',rehydration:'titan-runtime/page-context-rehydration.js',required:true,lifecycle:Object.freeze(['restart'])}),
    }),
    direct_mutation:false,
    execution_permitted:false,
    authority_effect:false,
    grants_authority:false,
    identity_not_authority:true,
  });
}

function normalizeSurfaceResult(surface,value){
  const raw=value&&typeof value==='object'?value:{};
  return immutable({
    surface,
    ok:raw.ok===true,
    code:clean(raw.code)||(raw.ok===true?'READY':'UNVERIFIED'),
  });
}

export function evaluateDeterministicChromeLoadCycle(input={}){
  rejectLegacy(input,'cycle');
  const plan=input.plan;
  if(!plan||plan.schema!=='titan.chrome-load.deterministic-plan.v1')throw new Error('deterministic-load-plan-required');
  const lifecycle=clean(input.lifecycle);
  if(!VALID_LIFECYCLES.has(lifecycle))throw new Error(`invalid-lifecycle:${lifecycle||'empty'}`);
  const companyId=clean(input.company_id);
  const online=input.online!==false;
  const results={};
  const failed=[];
  for(const surface of plan.required_surfaces){
    const result=normalizeSurfaceResult(surface,input.surface_results?.[surface]);
    results[surface]=result;
    if(!result.ok)failed.push(surface);
  }
  return immutable({
    schema:'titan.chrome-load.deterministic-cycle.v1',
    lifecycle,
    company_id:companyId||null,
    online,
    offline:!online,
    ok:failed.length===0,
    surface_results:immutable(results),
    failed_surfaces:Object.freeze(failed),
    direct_mutation:false,
    execution_permitted:false,
    authority_effect:false,
    grants_authority:false,
    identity_not_authority:true,
  });
}

export function summarizeDeterministicChromeLoadCycles(cycles=[]){
  if(!Array.isArray(cycles))throw new Error('cycles-must-be-array');
  rejectLegacy(cycles,'cycles');
  const lifecycleCounts={load:0,reload:0,restart:0};
  const failedSurfaces={};
  let passed=0;
  for(const cycle of cycles){
    if(!cycle||cycle.schema!=='titan.chrome-load.deterministic-cycle.v1')throw new Error('invalid-cycle-evidence');
    if(!(cycle.lifecycle in lifecycleCounts))throw new Error(`invalid-cycle-lifecycle:${cycle.lifecycle}`);
    lifecycleCounts[cycle.lifecycle]+=1;
    if(cycle.ok)passed+=1;
    for(const surface of cycle.failed_surfaces||[])failedSurfaces[surface]=(failedSurfaces[surface]||0)+1;
  }
  return immutable({
    schema:'titan.chrome-load.deterministic-summary.v1',
    ok:cycles.length>0&&passed===cycles.length,
    total_cycles:cycles.length,
    passed_cycles:passed,
    failed_cycles:cycles.length-passed,
    lifecycle_counts:immutable(lifecycleCounts),
    failed_surfaces:immutable(failedSurfaces),
    direct_mutation:false,
    execution_permitted:false,
    authority_effect:false,
    grants_authority:false,
    identity_not_authority:true,
  });
}
