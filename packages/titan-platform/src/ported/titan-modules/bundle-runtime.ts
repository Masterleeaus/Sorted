// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/bundle-runtime.mjs
import {normalizeModuleManifest} from './module-registry.js';
import {normalizeAuthority} from './authority.js';

const ID_RE=/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const SEMVER_RE=/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const PACK_TYPES=new Set(['module','workforce','team','vertical','integration','system']);
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

export function normalizeModuleBundle(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Module bundle must be a JSON object');
  if(String(input.schema||'')!=='titan-module-bundle/v1')throw new Error('Module bundle schema must be titan-module-bundle/v1');
  const id=String(input.id||'').trim().toLowerCase();
  if(!ID_RE.test(id))throw new Error('Module bundle id is invalid');
  const name=String(input.name||'').trim();if(!name)throw new Error('Module bundle name is required');
  const version=String(input.version||'').trim();if(!SEMVER_RE.test(version))throw new Error('Module bundle version must be semver');
  const pack_type=String(input.pack_type||'module').trim().toLowerCase();if(!PACK_TYPES.has(pack_type))throw new Error(`Unsupported module bundle pack_type: ${pack_type}`);
  const authority=normalizeAuthority(input.authority||{});
  const rawModules=Array.isArray(input.modules)?input.modules:[];if(!rawModules.length)throw new Error('Module bundle must contain at least one module');
  const modules=[];const seen=new Set();
  for(const raw of rawModules){
    const module=normalizeModuleManifest({...clone(raw),kind:'declarative'},{source:`bundle:${id}`});
    if(seen.has(module.id))throw new Error(`Duplicate module in bundle: ${module.id}`);
    seen.add(module.id);modules.push(module);
  }
  return {
    schema:'titan-module-bundle/v1',id,name,version,pack_type,
    description:String(input.description||'').trim(),
    authority,modules,
    metadata:input.metadata&&typeof input.metadata==='object'&&!Array.isArray(input.metadata)?clone(input.metadata):{},
  };
}
