// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/lifecycle-history.mjs
const MODULE_KEY='titanModuleVersionHistory';
const BUNDLE_KEY='titanBundleVersionHistory';
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const norm=value=>String(value||'').trim().toLowerCase();

export function createModuleHistoryStore({storage=globalThis.chrome?.storage?.local,maxEntries=5,moduleKey=MODULE_KEY,bundleKey=BUNDLE_KEY}={}){
  if(!storage?.get||!storage?.set)throw new Error('Lifecycle history storage is required');
  const max=Math.max(1,Math.min(20,Number(maxEntries)||5));
  async function getMap(key){const data=await storage.get([key]);return data[key]&&typeof data[key]==='object'&&!Array.isArray(data[key])?data[key]:{};}
  async function push(key,id,snapshot){const map=await getMap(key);const target=norm(id);const list=Array.isArray(map[target])?map[target]:[];list.push({...clone(snapshot),recorded_at:new Date().toISOString()});map[target]=list.slice(-max);await storage.set({[key]:map});return clone(map[target]);}
  async function list(key,id){const map=await getMap(key);return clone(Array.isArray(map[norm(id)])?map[norm(id)]:[]);}
  async function find(key,id,version){const items=await list(key,id);return clone([...items].reverse().find(item=>String(item.version)===String(version))||null);}
  return Object.freeze({
    pushModule:snapshot=>push(moduleKey,snapshot?.id,snapshot),
    listModule:id=>list(moduleKey,id),
    findModule:(id,version)=>find(moduleKey,id,version),
    pushBundle:snapshot=>push(bundleKey,snapshot?.id,snapshot),
    listBundle:id=>list(bundleKey,id),
    findBundle:(id,version)=>find(bundleKey,id,version),
  });
}
