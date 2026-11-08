// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/module-manager.mjs
import {resolveDependencies} from './dependency-resolver.js';
import {moduleAppliesToCompany} from './module-registry.js';

export const COMPANY_STATES_KEY='titanModuleCompanyStates';
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const MODULE_ID=/^[a-z0-9][a-z0-9._-]{1,127}$/;
const COMPANY_ID=/^[A-Za-z0-9._:-]{2,128}$/;

export function normalizeManagedCompanyId(value){
  if(value&&typeof value==='object'){
    if('tenant_id' in value||'tenant_company_id' in value||'organisation_id' in value||'organization_id' in value||'workspace_tenant_id' in value){
      throw new Error('company_id is the only canonical company boundary; legacy tenant identifiers are not accepted');
    }
    value=value.company_id;
  }
  const id=String(value??'').trim();
  if(!COMPANY_ID.test(id))throw new Error('A valid company_id is required for company module management');
  return id;
}

function normalizeModuleId(value){
  const id=String(value??'').trim().toLowerCase();
  if(!MODULE_ID.test(id))throw new Error('A valid module id is required');
  return id;
}

function normalizeStateTree(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};
  const out={};
  for(const [companyId,modules] of Object.entries(raw)){
    if(!COMPANY_ID.test(companyId)||!modules||typeof modules!=='object'||Array.isArray(modules))continue;
    out[companyId]={};
    for(const [moduleId,state] of Object.entries(modules)){
      if(!MODULE_ID.test(moduleId)||!state||typeof state!=='object'||Array.isArray(state))continue;
      out[companyId][moduleId]={
        ...(typeof state.enabled==='boolean'?{enabled:state.enabled}:{}),
        config:state.config&&typeof state.config==='object'&&!Array.isArray(state.config)?clone(state.config):{},
        updatedAt:Number(state.updatedAt)||0,
      };
    }
  }
  return out;
}

export function createModuleManager({storage,key=COMPANY_STATES_KEY,clock=()=>Date.now()}={}){
  if(!storage||typeof storage.get!=='function'||typeof storage.set!=='function')throw new Error('Module manager requires storage with get/set');

  async function readTree(){
    const data=await storage.get([key]);
    return normalizeStateTree(data?.[key]);
  }
  async function writeTree(tree){await storage.set({[key]:clone(tree)});}
  async function getState(moduleId,company_id){
    const id=normalizeModuleId(moduleId),company=normalizeManagedCompanyId(company_id);
    const tree=await readTree();
    return clone(tree[company]?.[id]||{config:{},updatedAt:0});
  }
  async function mutateState(moduleId,company_id,mutator){
    const id=normalizeModuleId(moduleId),company=normalizeManagedCompanyId(company_id);
    const tree=await readTree();
    const current=clone(tree[company]?.[id]||{config:{},updatedAt:0});
    const next=mutator(current)||current;
    tree[company] ||= {};
    tree[company][id]={
      ...(typeof next.enabled==='boolean'?{enabled:next.enabled}:{}),
      config:next.config&&typeof next.config==='object'&&!Array.isArray(next.config)?clone(next.config):{},
      updatedAt:Number(clock()),
    };
    await writeTree(tree);
    return clone(tree[company][id]);
  }
  async function isEnabled(record,company_id){
    if(!record?.manifest?.id)return false;
    const company=normalizeManagedCompanyId(company_id);
    if(!record.enabled||['error','quarantined'].includes(record.status))return false;
    if(!moduleAppliesToCompany(record.manifest,company))return false;
    const state=await getState(record.manifest.id,company);
    return typeof state.enabled==='boolean'?state.enabled:true;
  }
  async function overlay(records,company_id){
    const company=normalizeManagedCompanyId(company_id);
    const result=[];
    for(const record of records||[]){
      if(!record?.manifest?.id||!moduleAppliesToCompany(record.manifest,company))continue;
      result.push({...record,enabled:await isEnabled(record,company),company_id:company});
    }
    return result;
  }
  async function resolve(records,company_id){
    const company=normalizeManagedCompanyId(company_id);
    const effective=await overlay(records,company);
    const dependency=resolveDependencies(effective);
    return {...dependency,company_id:company};
  }
  async function discoverCapabilities(records,company_id){
    const company=normalizeManagedCompanyId(company_id);
    const effective=await overlay(records,company);
    const dependency=resolveDependencies(effective);
    const items=[];
    for(const record of effective){
      if(!record.enabled||dependency.blocked[record.manifest.id])continue;
      for(const capability of record.manifest.contributes?.capabilities||[]){
        const item=typeof capability==='string'?{id:capability}:{...clone(capability)};
        if(!item.id)continue;
        items.push({moduleId:record.manifest.id,moduleName:record.manifest.name,moduleVersion:record.manifest.version,company_id:company,...item});
      }
    }
    items.sort((a,b)=>a.id.localeCompare(b.id)||a.moduleId.localeCompare(b.moduleId));
    return items;
  }

  return Object.freeze({
    key,
    getState,
    async listStates(company_id){const company=normalizeManagedCompanyId(company_id);const tree=await readTree();return clone(tree[company]||{});},
    async isEnabled(record,company_id){return isEnabled(record,company_id);},
    async setEnabled(moduleId,company_id,enabled){return mutateState(moduleId,company_id,state=>({...state,enabled:Boolean(enabled)}));},
    async clearEnabledOverride(moduleId,company_id){
      return mutateState(moduleId,company_id,state=>{const next={...state};delete next.enabled;return next;});
    },
    async getConfig(moduleId,company_id){return clone((await getState(moduleId,company_id)).config||{});},
    async updateConfig(moduleId,company_id,values){
      if(!values||typeof values!=='object'||Array.isArray(values))throw new Error('Module company config must be an object');
      return clone((await mutateState(moduleId,company_id,state=>({...state,config:{...(state.config||{}),...clone(values)}}))).config);
    },
    overlay,
    resolve,
    discoverCapabilities,
  });
}
