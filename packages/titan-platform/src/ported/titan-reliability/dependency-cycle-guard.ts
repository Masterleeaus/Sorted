// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/dependency-cycle-guard.mjs
const clean=v=>String(v??'').trim();
export function inspectDependencyGraph({company_id,dependencies=[]}={}){
 const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
 const graph=new Map();
 for(const item of Array.isArray(dependencies)?dependencies:[]){
  const itemCompany=clean(item?.company_id); if(itemCompany && itemCompany!==companyId) throw new Error('cross-company:dependency-cycle');
  const id=clean(item?.operation_id); if(!id) continue;
  graph.set(id,(Array.isArray(item?.depends_on)?item.depends_on:[]).map(clean).filter(Boolean));
 }
 const visiting=new Set(), visited=new Set(), cyclic=new Set(), stack=[];
 function dfs(id){
  if(visiting.has(id)){
   const idx=stack.indexOf(id); for(const x of (idx>=0?stack.slice(idx):[id])) cyclic.add(x); cyclic.add(id); return;
  }
  if(visited.has(id)) return;
  visiting.add(id); stack.push(id);
  for(const dep of graph.get(id)||[]) if(graph.has(dep)) dfs(dep);
  stack.pop(); visiting.delete(id); visited.add(id);
 }
 for(const id of graph.keys()) dfs(id);
 const ids=[...cyclic].sort();
 return Object.freeze({company_id:companyId,cyclic_operation_ids:Object.freeze(ids),safe_to_schedule:ids.length===0,auto_break_cycle:false,requires_explicit_resolution:ids.length>0,authority_effect:false,grants_authority:false});
}
