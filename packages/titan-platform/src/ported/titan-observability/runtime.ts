// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-observability/runtime.mjs
import { normalizeObservation, OBSERVABILITY_PROTOCOL, OBSERVABILITY_MODULE_ID, OBSERVABILITY_COLLECTION } from './contracts.js';

const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const safeError=error=>String(error?.message||error||'unknown error');

export function createObservabilityRuntime({database,companyIdProvider,clock=Date.now,idFactory=null}={}){
  if(!database||typeof database.putRecord!=='function'||typeof database.listRecords!=='function')throw new TypeError('observability-database-required');
  if(typeof companyIdProvider!=='function')throw new TypeError('observability-company-provider-required');
  const collectors=new Map();
  const severityCounts={debug:0,info:0,warn:0,error:0,critical:0};
  const componentCounts={};
  let recorded=0,lastEvent=null;

  async function companyId({required=true}={}){
    const value=String(await companyIdProvider()||'').trim();
    if(required&&!value)throw new Error('company_id-required');
    return value||null;
  }

  function registerCollector(id,collector){
    const key=String(id??'').trim();
    if(!key)throw new TypeError('collector-id-required');
    if(typeof collector!=='function')throw new TypeError('collector-function-required');
    collectors.set(key,collector);
    return ()=>collectors.delete(key);
  }

  async function record(raw){
    const activeCompanyId=await companyId();
    const eventId=String(raw?.event_id||'').trim()||(idFactory?.()||undefined);
    const event=normalizeObservation({...raw,event_id:eventId},{company_id:activeCompanyId,clock});
    await database.putRecord({
      company_id:event.company_id,
      actor_id:event.actor_id||'titan-observability',
      operation_id:event.operation_id||event.event_id,
      idempotency_key:`observability:${event.event_id}`,
    },{
      module_id:OBSERVABILITY_MODULE_ID,
      collection:OBSERVABILITY_COLLECTION,
      record_id:event.event_id,
      data:event,
      provenance:{source:event.source,component:event.component,correlation_id:event.correlation_id,company_id:event.company_id,authority_effect:false},
    });
    recorded+=1;lastEvent=event;
    severityCounts[event.severity]=(severityCounts[event.severity]||0)+1;
    componentCounts[event.component]=(componentCounts[event.component]||0)+1;
    return event;
  }

  async function recent({limit=100,correlation_id=null,operation_id=null,component=null,severity=null}={}){
    const activeCompanyId=await companyId();
    const rows=await database.listRecords({company_id:activeCompanyId,actor_id:'titan-observability-reader'},{module_id:OBSERVABILITY_MODULE_ID,collection:OBSERVABILITY_COLLECTION,order_by:'updated_at',direction:'desc',limit:Math.min(1000,Math.max(Number(limit)||100,100))});
    let events=rows.map(row=>row?.data).filter(Boolean);
    if(correlation_id)events=events.filter(event=>event.correlation_id===correlation_id);
    if(operation_id)events=events.filter(event=>event.operation_id===operation_id);
    if(component)events=events.filter(event=>event.component===component);
    if(severity)events=events.filter(event=>event.severity===severity);
    events=events.slice(0,Math.max(0,Number(limit)||100));
    return Object.freeze({schema:'titan.observability.recent.v1',company_id:activeCompanyId,count:events.length,events:Object.freeze(events.map(clone)),observability_not_authority:true,authority_effect:false});
  }

  async function snapshot(){
    const activeCompanyId=await companyId({required:false});
    const components={};
    for(const [id,collector] of collectors){
      try{
        const value=await collector({company_id:activeCompanyId});
        components[id]=Object.freeze({...(value&&typeof value==='object'?clone(value):{value}),ok:value?.ok!==false});
      }catch(error){components[id]=Object.freeze({ok:false,error:safeError(error)});}
    }
    const degraded=Object.values(components).some(item=>item?.ok===false);
    return Object.freeze({
      schema:'titan.observability.snapshot.v1',protocol:OBSERVABILITY_PROTOCOL,company_id:activeCompanyId,
      companyBoundary:'company_id',status:degraded?'degraded':'healthy',ok:!degraded,
      generated_at:Number(clock()),recorded,severityCounts:Object.freeze({...severityCounts}),componentCounts:Object.freeze({...componentCounts}),
      lastEvent:clone(lastEvent),components:Object.freeze(components),collectorCount:collectors.size,
      persistenceAuthority:'TitanBusinessDatabase',observability_not_authority:true,grants_authority:false,authority_effect:false,
    });
  }

  return Object.freeze({protocol:OBSERVABILITY_PROTOCOL,registerCollector,record,recent,snapshot,companyId,authority_effect:false,observability_not_authority:true});
}
