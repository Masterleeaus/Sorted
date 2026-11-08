// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/resource-lifecycle-tracker.mjs
const freeze = value => Object.freeze(value);

export function createResourceLifecycleTracker({name='titan-resource-lifecycle', maxOpen=256}={}) {
  const open = new Map();
  const counters = {registered:0,released:0,duplicateKeys:0,highWater:0,rejected:0};
  const register = ({key,type='resource',owner='unknown',detail=null}={}) => {
    const id=String(key||'').trim();
    if(!id) throw new TypeError('resource key is required');
    if(open.has(id)) { counters.duplicateKeys += 1; return freeze({ok:false,reason:'duplicate-key',key:id,authority_effect:false}); }
    if(open.size >= maxOpen) { counters.rejected += 1; return freeze({ok:false,reason:'resource-capacity',key:id,authority_effect:false}); }
    const record=freeze({key:id,type:String(type||'resource'),owner:String(owner||'unknown'),detail,opened_at:Date.now(),authority_effect:false});
    open.set(id,record); counters.registered += 1; counters.highWater=Math.max(counters.highWater,open.size);
    return freeze({ok:true,record,authority_effect:false});
  };
  const release = key => {
    const id=String(key||'').trim();
    const existed=open.delete(id); if(existed) counters.released += 1;
    return freeze({ok:existed,key:id,authority_effect:false});
  };
  const snapshot = () => freeze({name,open_count:open.size,max_open:maxOpen,...counters,balanced:open.size===0,open:[...open.values()],grants_authority:false,authority_effect:false});
  const assertBalanced = () => { const s=snapshot(); if(!s.balanced){ const e=new Error(`resource-leak:${s.open_count}`); e.code='TITAN_RESOURCE_LEAK'; e.snapshot=s; throw e; } return s; };
  return freeze({register,release,snapshot,assertBalanced});
}
