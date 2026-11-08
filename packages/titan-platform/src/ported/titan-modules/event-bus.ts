// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/event-bus.mjs
const TYPE_RE=/^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

export function createEventBus({storage,maxEvents=200,now=()=>Date.now(),uuid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`,prefix='titanModuleEvents'}={}){
  if(!storage?.get||!storage?.set)throw new Error('Event bus requires storage.get/set');
  const limit=Math.max(1,Math.min(Number(maxEvents)||200,1000));
  const keyFor=company_id=>`${prefix}:${company_id}`;
  const requireCompany=value=>{const id=String(value||'').trim();if(!id)throw new Error('Module events require company_id');return id;};
  return Object.freeze({
    async publish(raw={}){
      const company_id=requireCompany(raw.company_id);
      const type=String(raw.type||'').trim();
      if(!TYPE_RE.test(type))throw new Error('Module event type is invalid');
      const module_id=String(raw.module_id||'').trim().toLowerCase();
      if(!module_id)throw new Error('Module event requires module_id');
      const event={event_id:String(raw.event_id||uuid()),type,module_id,company_id,occurred_at:new Date(Number(now())).toISOString(),payload:clone(raw.payload??{})};
      const key=keyFor(company_id);const data=await storage.get([key]);const log=Array.isArray(data[key])?data[key]:[];
      log.unshift(event);await storage.set({[key]:log.slice(0,limit).map(clone)});return clone(event);
    },
    async list({company_id,limit:requested=limit}={}){
      const cid=requireCompany(company_id);const key=keyFor(cid);const data=await storage.get([key]);
      const log=Array.isArray(data[key])?data[key]:[];return clone(log.slice(0,Math.max(0,Math.min(Number(requested)||limit,limit))));
    },
    async clear({company_id}={}){const cid=requireCompany(company_id);await storage.set({[keyFor(cid)]:[]});return true;},
  });
}
