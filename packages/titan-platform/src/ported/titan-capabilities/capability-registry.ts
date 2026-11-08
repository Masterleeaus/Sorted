// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-capabilities/capability-registry.mjs
const REGISTRY_VERSION='1.0.0';
const ACTIVE_EXCLUSIONS=new Set(['blocked','error','quarantined']);
const TYPE_KIND={
  capabilities:'capability',commands:'action',queries:'query',workers:'worker',tools:'tool',providers:'provider',
  projections:'projection',workflows:'workflow',events:'event',verticals:'vertical',intents:'intent',links:'link',feed:'feed',
  settings:'setting',screens:'screen',settingsPanels:'settings_panel',
};
const CONTRIBUTION_ORDER=Object.keys(TYPE_KIND);
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const arr=value=>Array.isArray(value)?value:[];
const uniq=value=>[...new Set(arr(value).map(v=>String(v).trim()).filter(Boolean))];
const text=value=>String(value??'').trim();
const companyMatches=(manifest,company_id)=>{
  const scoped=manifest?.scope?.company_id||null;
  if(!scoped) return true;
  return Boolean(company_id)&&String(company_id)===String(scoped);
};

function riskFor(item,kind){
  const explicit=text(item?.riskClass||item?.risk_class||item?.risk||item?.riskCeiling||item?.risk_ceiling).toUpperCase();
  if(explicit) return explicit;
  if(item?.mutates) return 'MEDIUM';
  return kind==='worker'?'LOW':'LOW';
}

function titleFor(item,kind){
  return text(item?.title||item?.name||item?.label||item?.role||item?.id||kind);
}

function moduleEntry(record,type,item){
  const manifest=record.manifest;
  const kind=TYPE_KIND[type]||type.replace(/s$/,'');
  const id=text(item?.id||item?.type||item?.key||titleFor(item,kind));
  const moduleId=manifest.id;
  const capabilities=uniq(item?.capabilities);
  const authority=uniq(item?.authority);
  const entry={
    registry_id:`${moduleId}:${kind}:${id}`,
    id,
    kind,
    contribution_type:type,
    title:titleFor(item,kind),
    description:text(item?.description||item?.purpose),
    module_id:moduleId,
    module_name:manifest.name,
    module_version:manifest.version,
    company_id:manifest.scope?.company_id||null,
    capabilities,
    authority,
    permissions:uniq(item?.permissions),
    mutates:Boolean(item?.mutates),
    risk_class:riskFor(item,kind),
    risk_ceiling:text(item?.riskCeiling||item?.risk_ceiling).toUpperCase()||null,
    autonomy:text(item?.autonomy).toLowerCase()||null,
    requirements:clone(manifest.requires?.modules||[]),
    activation_confers_authority:false,
    source:'module',
    raw:clone(item),
  };
  if(kind==='worker'){
    entry.tools=uniq(item?.tools);
    entry.workflow=item?.workflow||null;
    entry.channels=uniq(item?.channels);
    entry.department=text(item?.department)||null;
    entry.vertical=text(item?.vertical).toLowerCase()||null;
    entry.execution_contract={
      instructions:text(item?.instructions),
      autonomy:entry.autonomy,
      risk_ceiling:entry.risk_ceiling||entry.risk_class,
      evidence_required:uniq(item?.evidenceRequired||item?.evidence_required),
      approval_required_for:uniq(item?.approvalRequiredFor||item?.approval_required_for),
    };
  }
  if(kind==='tool') entry.command=item?.command||null;
  if(kind==='workflow') entry.steps=clone(item?.steps||[]);
  return entry;
}

function serviceEntry(service){
  const id=text(service?.service||service?.id);
  if(!id) return null;
  const owner=text(service?.owner||service?.authority_owner||service?.system||service?.domain_owner);
  return {
    registry_id:`titan.platform:service:${id}`,
    id,kind:'service',contribution_type:'services',title:text(service?.title||service?.name||id),
    description:text(service?.description||service?.purpose),module_id:'titan.platform',module_name:'Titan Platform Services',module_version:null,
    company_id:null,capabilities:uniq(service?.capabilities),authority:[],permissions:[],mutates:false,risk_class:'LOW',risk_ceiling:null,autonomy:null,
    requirements:[],activation_confers_authority:false,source:'platform-service',owner:owner||null,raw:clone(service),
  };
}

function certifiedWorkflowEntry(workflow){
  const id=text(workflow?.id);
  if(!id) return null;
  return {
    registry_id:`titan.platform:workflow:${id}`,
    id,kind:'workflow',contribution_type:'certified_workflows',title:text(workflow?.title||id),description:text(workflow?.description),
    module_id:'titan.platform',module_name:'Titan Certified Workflows',module_version:null,company_id:null,
    capabilities:uniq([workflow?.capability].filter(Boolean)),authority:[],permissions:[],mutates:Boolean(workflow?.mutates),
    risk_class:text(workflow?.risk_class||workflow?.risk).toUpperCase()||'LOW',risk_ceiling:null,autonomy:null,
    requirements:[],activation_confers_authority:false,source:'certified-workflow',service:text(workflow?.service)||null,raw:clone(workflow),
  };
}


function nativeWorkerEntry(worker){
  const id=text(worker?.role_definition_id||worker?.id);
  if(!id) return null;
  const caps=uniq(worker?.operational_domains||worker?.capabilities);
  const risk=text(worker?.risk_ceiling||worker?.riskCeiling).toUpperCase()||'LOW';
  return {
    registry_id:`titan.workforce:worker:${id}`,
    id,kind:'worker',contribution_type:'native_workers',title:text(worker?.name||id),description:text(worker?.purpose||worker?.description),
    module_id:'titan.workforce',module_name:'Titan Installed Client Workforce',module_version:null,company_id:null,
    capabilities:caps,authority:[],permissions:[],mutates:false,risk_class:risk,risk_ceiling:risk,autonomy:null,
    requirements:[],activation_confers_authority:false,source:'native-workforce',department:text(worker?.division_key)||null,
    verticals:uniq(worker?.verticals),execution_contract:{instructions:'',autonomy:null,risk_ceiling:risk,evidence_required:[],approval_required_for:[]},raw:clone(worker),
  };
}

function nativeEntry(item){
  const id=text(item?.id);
  if(!id) return null;
  const kind=text(item?.kind||'capability').toLowerCase();
  return {
    registry_id:`titan.native:${kind}:${id}`,
    id,kind,contribution_type:'native',title:text(item?.title||item?.name||id),description:text(item?.description||item?.purpose),
    module_id:'titan.native',module_name:'Titan Native Runtime',module_version:null,company_id:item?.company_id||null,
    capabilities:uniq(item?.capabilities),authority:uniq(item?.authority),permissions:uniq(item?.permissions),mutates:Boolean(item?.mutates),
    risk_class:text(item?.risk_class||item?.risk||'LOW').toUpperCase(),risk_ceiling:text(item?.risk_ceiling).toUpperCase()||null,autonomy:text(item?.autonomy).toLowerCase()||null,
    requirements:clone(item?.requirements||[]),activation_confers_authority:false,source:'native-runtime',raw:clone(item),
  };
}

function buildIndex(entries){
  const by_kind={},by_capability={},by_module={},by_risk={};
  for(const entry of entries){
    (by_kind[entry.kind]??=[]).push(entry.registry_id);
    (by_module[entry.module_id]??=[]).push(entry.registry_id);
    (by_risk[entry.risk_class]??=[]).push(entry.registry_id);
    for(const cap of entry.capabilities||[]) (by_capability[cap]??=[]).push(entry.registry_id);
    if(entry.kind==='capability') (by_capability[entry.id]??=[]).push(entry.registry_id);
  }
  return {by_kind,by_capability,by_module,by_risk};
}

export function buildCapabilityRegistry(records,{company_id=null,services=[],certifiedWorkflows=[],nativeWorkers=[],nativeEntries=[]}={}){
  const canonicalCompanyId=company_id==null||company_id===''?null:String(company_id).trim();
  if(company_id!=null && company_id!=='' && !canonicalCompanyId) throw new TypeError('company_id-required');
  const entries=[];
  const modules=[];
  for(const record of records||[]){
    if(!record?.manifest||!record.enabled||ACTIVE_EXCLUSIONS.has(record.status)||!companyMatches(record.manifest,canonicalCompanyId)) continue;
    const manifest=record.manifest;
    modules.push({
      module_id:manifest.id,module_name:manifest.name,module_version:manifest.version,company_id:manifest.scope?.company_id||null,
      requirements:clone(manifest.requires?.modules||[]),permissions:uniq(manifest.permissions),authority:clone(manifest.authority||{activation_confers_authority:false,requests:[]}),
    });
    for(const type of CONTRIBUTION_ORDER){
      for(const item of arr(manifest.contributes?.[type])) entries.push(moduleEntry(record,type,item));
    }
  }
  for(const service of services||[]){ const entry=serviceEntry(service); if(entry) entries.push(entry); }
  for(const workflow of certifiedWorkflows||[]){ const entry=certifiedWorkflowEntry(workflow); if(entry) entries.push(entry); }
  for(const worker of nativeWorkers||[]){ const entry=nativeWorkerEntry(worker); if(entry) entries.push(entry); }
  for(const item of nativeEntries||[]){ const entry=nativeEntry(item); if(entry) entries.push(entry); }
  entries.sort((a,b)=>a.registry_id.localeCompare(b.registry_id));
  return {
    version:REGISTRY_VERSION,
    company_id:canonicalCompanyId,
    authority:{activation_confers_authority:false,rule:'identity_or_registration_never_grants_execution_authority'},
    modules:modules.sort((a,b)=>a.module_id.localeCompare(b.module_id)),
    entries,index:buildIndex(entries),
    totals:{entries:entries.length,modules:modules.length,by_kind:Object.fromEntries(Object.entries(buildIndex(entries).by_kind).map(([k,v])=>[k,v.length]))},
  };
}

export function getCapability(registry,registryId){
  const id=text(registryId);
  return registry?.entries?.find(entry=>entry.registry_id===id)||null;
}

export function findCapabilities(registry,query,{kind=null,module_id=null,risk_class=null,capability=null,limit=100}={}){
  const q=text(query).toLowerCase();
  const tokens=q.split(/\s+/).filter(Boolean);
  const result=[];
  for(const entry of registry?.entries||[]){
    if(kind&&entry.kind!==kind) continue;
    if(module_id&&entry.module_id!==module_id) continue;
    if(risk_class&&entry.risk_class!==String(risk_class).toUpperCase()) continue;
    if(capability&&entry.id!==capability&&!entry.capabilities?.includes(capability)) continue;
    const hay=[entry.registry_id,entry.id,entry.kind,entry.title,entry.description,entry.module_id,...(entry.capabilities||[]),...(entry.authority||[])].join(' ').toLowerCase();
    if(tokens.length&&tokens.some(token=>!hay.includes(token))) continue;
    result.push(entry);
    if(result.length>=Math.max(1,Number(limit)||100)) break;
  }
  return result;
}

export const CAPABILITY_REGISTRY_VERSION=REGISTRY_VERSION;
