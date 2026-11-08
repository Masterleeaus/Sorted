// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/dependency-resolver.mjs
import {satisfiesVersion} from './semver.js';

function add(blocked,id,message){(blocked[id]||(blocked[id]=[])).push(message);}

export function resolveDependencies(records=[]){
  const active=(records||[]).filter(r=>r?.enabled&&r?.manifest?.id);
  const byId=new Map(active.map(r=>[String(r.manifest.id).toLowerCase(),r]));
  const blocked={};
  const edges=new Map();
  for(const record of active){
    const id=record.manifest.id;
    const deps=[];
    for(const dep of record.manifest.requires?.modules||[]){
      const target=byId.get(String(dep.id).toLowerCase());
      if(!target){if(!dep.optional)add(blocked,id,`Missing dependency ${dep.id} ${dep.range||'*'}`);continue;}
      if(!satisfiesVersion(target.manifest.version,dep.range||'*')){
        add(blocked,id,`Module ${id} requires ${dep.id} ${dep.range||'*'} but found ${target.manifest.version}`);
        continue;
      }
      deps.push(target.manifest.id);
    }
    edges.set(id,[...new Set(deps)].sort());
  }
  const state=new Map(),stack=[];
  function visit(id){
    const s=state.get(id)||0;
    if(s===2)return;
    if(s===1){
      const idx=stack.indexOf(id);const cycle=(idx>=0?stack.slice(idx):[id]).concat(id);
      for(const member of new Set(cycle))add(blocked,member,`Dependency cycle detected: ${cycle.join(' -> ')}`);
      return;
    }
    state.set(id,1);stack.push(id);
    for(const dep of edges.get(id)||[])visit(dep);
    stack.pop();state.set(id,2);
  }
  for(const id of [...byId.keys()].sort())visit(id);

  const order=[];const seen=new Set();
  function emit(id){
    if(seen.has(id)||blocked[id])return;
    for(const dep of edges.get(id)||[])emit(dep);
    if(!seen.has(id)){seen.add(id);order.push(id);}
  }
  for(const id of [...byId.keys()].sort())emit(id);
  return {ok:Object.keys(blocked).length===0,order,blocked};
}
