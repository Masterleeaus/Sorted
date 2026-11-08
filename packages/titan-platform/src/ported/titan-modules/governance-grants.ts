// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/governance-grants.mjs
const DEFAULT_KEY='titanGovernanceAuthorityGrants';
const COMPANY_RE=/^[A-Za-z0-9._:-]{2,128}$/;
const ID_RE=/^[a-z0-9][a-z0-9._:-]{0,127}$/;
const FORBIDDEN_SCOPE_KEYS=new Set(['tenant_id','tenant_company_id']);
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const uniq=value=>[...new Set((Array.isArray(value)?value:[]).map(v=>String(v||'').trim().toLowerCase()).filter(Boolean))];

function assertNoLegacy(value,path='grant'){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach((item,index)=>assertNoLegacy(item,`${path}[${index}]`));return;}
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN_SCOPE_KEYS.has(key))throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is the only company boundary`);
    assertNoLegacy(child,`${path}.${key}`);
  }
}
function id(value,field){const out=String(value||'').trim().toLowerCase();if(!ID_RE.test(out))throw new Error(`${field} is invalid`);return out;}
function company(value){const out=String(value||'').trim();if(!COMPANY_RE.test(out))throw new Error('A valid company_id is required');return out;}
function newId(){return globalThis.crypto?.randomUUID?.()||`grant-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;}

export function createGovernanceGrantStore({storage=globalThis.chrome?.storage?.local,key=DEFAULT_KEY,now=()=>Date.now()}={}){
  if(!storage?.get||!storage?.set)throw new Error('Governance grant storage is required');
  async function read(){const data=await storage.get([key]);return Array.isArray(data[key])?data[key]:[];}
  async function write(items){await storage.set({[key]:items.map(clone)});}
  function activeState(grant){
    if(grant.status!=='active')return {ok:false,reason:'revoked or inactive'};
    if(grant.expires_at && Date.parse(grant.expires_at)<=now())return {ok:false,reason:'expired'};
    return {ok:true};
  }
  return Object.freeze({
    async issue(input){
      assertNoLegacy(input);
      const company_id=company(input?.company_id);
      const module_id=id(input?.module_id,'module_id');
      const authority_ids=uniq(input?.authority_ids);if(!authority_ids.length)throw new Error('authority_ids must not be empty');authority_ids.forEach(v=>id(v,'authority_ids'));
      const actions=uniq(input?.actions?.length?input.actions:['*']);actions.forEach(v=>{if(v!=='*')id(v,'actions')});
      const issued_by=String(input?.issued_by||'user:unknown').trim();if(!issued_by)throw new Error('issued_by is required');
      const expires_at=input?.expires_at?new Date(input.expires_at).toISOString():new Date(now()+60*60*1000).toISOString();
      if(Date.parse(expires_at)<=now())throw new Error('expires_at must be in the future');
      const grant={id:String(input?.id||newId()),company_id,module_id,authority_ids,actions,issued_by,issued_at:new Date(now()).toISOString(),expires_at,status:'active',reason:String(input?.reason||'').trim(),metadata:clone(input?.metadata||{})};
      const items=await read();items.push(grant);await write(items);return clone(grant);
    },
    async revoke(grantId,{revoked_by='user:unknown',reason=''}={}){
      const items=await read();const target=items.find(item=>String(item.id)===String(grantId));if(!target)throw new Error(`Authority grant not found: ${grantId}`);
      if(target.status!=='revoked'){target.status='revoked';target.revoked_at=new Date(now()).toISOString();target.revoked_by=String(revoked_by);target.revoke_reason=String(reason||'');await write(items);}return clone(target);
    },
    async list({company_id=null,module_id=null,include_inactive=true}={}){
      let items=await read();
      if(company_id!=null){const scoped=company(company_id);items=items.filter(item=>item.company_id===scoped);}
      if(module_id!=null){const target=id(module_id,'module_id');items=items.filter(item=>item.module_id===target);}
      if(!include_inactive)items=items.filter(item=>activeState(item).ok);
      return items.map(item=>({...clone(item),active:activeState(item).ok,state_reason:activeState(item).reason||null}));
    },
    async resolve({company_id,module_id,action,grant_ids=[]}={}){
      const scoped=company(company_id);const targetModule=id(module_id,'module_id');const targetAction=id(action,'action');
      const ids=[...new Set((Array.isArray(grant_ids)?grant_ids:[]).map(v=>String(v||'').trim()).filter(Boolean))];
      const items=await read();const authority=[];const used=[];
      for(const grantId of ids){
        const grant=items.find(item=>String(item.id)===grantId);if(!grant)throw new Error(`Authority grant not found: ${grantId}`);
        if(grant.company_id!==scoped)throw new Error(`Authority grant ${grantId} belongs to a different company_id`);
        if(grant.module_id!==targetModule)throw new Error(`Authority grant ${grantId} is for module ${grant.module_id}`);
        if(!grant.actions.includes('*')&&!grant.actions.includes(targetAction))throw new Error(`Authority grant ${grantId} does not permit action ${targetAction}`);
        const state=activeState(grant);if(!state.ok)throw new Error(`Authority grant ${grantId} is ${state.reason}`);
        authority.push(...grant.authority_ids);used.push(grant.id);
      }
      return {company_id:scoped,module_id:targetModule,action:targetAction,grant_ids:used,authority_grants:[...new Set(authority)]};
    },
  });
}
