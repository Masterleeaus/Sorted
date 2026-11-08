// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-local/kernel/module-contract.mjs
import {normalizeAuthorityBinding} from './authority-binding.js';
const ID_RE=/^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SEMVER_RE=/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const FORBIDDEN=new Set(['tenant_id','tenant_company_id']);
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

function assertNoLegacy(value,path='module'){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach((item,i)=>assertNoLegacy(item,`${path}[${i}]`));return;}
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN.has(key))throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is the only company boundary`);
    assertNoLegacy(child,`${path}.${key}`);
  }
}
function id(value,field){const out=String(value||'').trim().toLowerCase();if(!ID_RE.test(out))throw new Error(`${field} is invalid`);return out;}
function strings(value,field){if(value==null)return[];if(!Array.isArray(value))throw new Error(`${field} must be an array`);return [...new Set(value.map(v=>String(v||'').trim()).filter(Boolean))];}
function entries(value,field,{authority=false}={}){
  if(value==null)return[];if(!Array.isArray(value))throw new Error(`${field} must be an array`);
  const seen=new Set();
  return value.map((raw,index)=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(`${field}[${index}] must be an object`);
    const entryId=id(raw.id,`${field}[${index}].id`);if(seen.has(entryId))throw new Error(`Duplicate ${field} id: ${entryId}`);seen.add(entryId);
    const out={id:entryId,title:String(raw.title||entryId).trim(),description:String(raw.description||'').trim()};
    if(authority){out.mutates=Boolean(raw.mutates);out.authority=strings(raw.authority,`${field}[${index}].authority`).map(v=>v.toLowerCase());if(out.mutates&&!out.authority.length)throw new Error(`${field}[${index}] mutates state and must declare authority`);}
    return out;
  });
}

export function normalizeLocalModuleContract(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Local module contract must be an object');
  assertNoLegacy(input);
  const module_id=id(input.module_id,'module_id');
  const name=String(input.name||'').trim();if(!name)throw new Error('name is required');
  const version=String(input.version||'').trim();if(!SEMVER_RE.test(version))throw new Error('version must be semver');
  const company_id=input.company_id==null||input.company_id===''?null:String(input.company_id).trim();
  return Object.freeze({
    module_id,name,version,company_id,
    capabilities:strings(input.capabilities,'capabilities'),
    commands:entries(input.commands,'commands',{authority:true}),
    queries:entries(input.queries,'queries'),
    events:strings(input.events,'events').map(v=>v.toLowerCase()),
    projections:strings(input.projections,'projections').map(v=>v.toLowerCase()),
    storage:strings(input.storage,'storage'),
    sync_adapters:strings(input.sync_adapters,'sync_adapters').map(v=>v.toLowerCase()),
    permissions:strings(input.permissions,'permissions').map(v=>v.toLowerCase()),
    autonomy_policy:input.autonomy_policy&&typeof input.autonomy_policy==='object'&&!Array.isArray(input.autonomy_policy)?clone(input.autonomy_policy):{default:'suggest'},
    offline_support:input.offline_support!==false,
    dependencies:strings(input.dependencies,'dependencies').map(v=>v.toLowerCase()),
    authority_binding:normalizeAuthorityBinding(input.authority_binding||'local_primary'),
  });
}
