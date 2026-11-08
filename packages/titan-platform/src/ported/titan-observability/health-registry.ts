// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-observability/health-registry.mjs
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const safeError=error=>String(error?.message||error||'unknown error');
const CRITICALITIES=new Set(['info','standard','critical']);
const NORMAL_STATUSES=new Set(['healthy','degraded','unhealthy','unavailable']);

const clean=value=>String(value??'').trim();
const positiveInt=(value,fallback)=>{
  const n=Number(value);
  return Number.isFinite(n)&&n>0?Math.max(1,Math.min(60000,Math.floor(n))):fallback;
};

function normalizeStatus(value){
  const explicit=clean(value?.status).toLowerCase();
  if(NORMAL_STATUSES.has(explicit))return explicit;
  if(['ok','ready','available','active'].includes(explicit))return 'healthy';
  if(['warn','warning','partial'].includes(explicit))return 'degraded';
  if(['error','failed','failure','down'].includes(explicit))return 'unhealthy';
  if(['missing','offline','unknown'].includes(explicit))return 'unavailable';
  return value?.ok===false?'unhealthy':'healthy';
}

function overallStatus(probes){
  let degraded=false;
  for(const probe of Object.values(probes)){
    if(probe.status==='healthy')continue;
    if(probe.criticality==='critical'&&(probe.status==='unhealthy'||probe.status==='unavailable'))return 'unhealthy';
    degraded=true;
  }
  return degraded?'degraded':'healthy';
}

export function createRuntimeHealthRegistry({clock=Date.now,defaultTimeoutMs=1500}={}){
  if(typeof clock!=='function')throw new TypeError('health-clock-required');
  const registrations=new Map();
  const states=new Map();
  const fallbackTimeout=positiveInt(defaultTimeoutMs,1500);

  function registerProbe({id,probe,component=null,source='titan-zero',criticality='standard',timeout_ms=null,tags=[]}={}){
    const key=clean(id);
    if(!key)throw new TypeError('health-probe-id-required');
    if(typeof probe!=='function')throw new TypeError('health-probe-function-required');
    if(registrations.has(key))throw new Error(`health-probe-already-registered:${key}`);
    const level=clean(criticality).toLowerCase()||'standard';
    if(!CRITICALITIES.has(level))throw new TypeError(`unsupported-health-criticality:${level}`);
    const registration=Object.freeze({
      id:key,
      component:clean(component)||key,
      source:clean(source)||'titan-zero',
      criticality:level,
      timeout_ms:positiveInt(timeout_ms,fallbackTimeout),
      tags:Object.freeze([...new Set((Array.isArray(tags)?tags:[]).map(clean).filter(Boolean))]),
      probe,
    });
    registrations.set(key,registration);
    states.set(key,{consecutive_failures:0,last_success_at:null,last_failure_at:null,last_status:'unknown'});
    return ()=>{
      const removed=registrations.delete(key);
      states.delete(key);
      return removed;
    };
  }

  function list(){
    return Object.freeze([...registrations.values()].map(({probe,...registration})=>Object.freeze(clone(registration))));
  }

  async function runProbe(registration,{company_id}){
    const started=Number(clock());
    let timer=null,timedOut=false,value=null,error=null;
    const timeout=new Promise((_,reject)=>{
      timer=setTimeout(()=>{timedOut=true;reject(new Error(`health-probe-timeout:${registration.id}:${registration.timeout_ms}`));},registration.timeout_ms);
    });
    try{
      value=await Promise.race([
        Promise.resolve().then(()=>registration.probe({company_id,probe_id:registration.id,component:registration.component})),
        timeout,
      ]);
    }catch(err){error=err;}finally{if(timer!==null)clearTimeout(timer);}
    const completed=Number(clock());
    const state=states.get(registration.id)||{consecutive_failures:0,last_success_at:null,last_failure_at:null,last_status:'unknown'};
    const status=error?(timedOut?'unavailable':'unhealthy'):normalizeStatus(value);
    const failed=status==='unhealthy'||status==='unavailable';
    if(failed){state.consecutive_failures+=1;state.last_failure_at=completed;}
    else{state.consecutive_failures=0;state.last_success_at=completed;}
    state.last_status=status;states.set(registration.id,state);
    return Object.freeze({
      id:registration.id,
      component:registration.component,
      source:registration.source,
      criticality:registration.criticality,
      tags:registration.tags,
      status,
      ok:status==='healthy'||status==='degraded',
      timed_out:timedOut,
      timeout_ms:registration.timeout_ms,
      latency_ms:Math.max(0,completed-started),
      observed_at:completed,
      consecutive_failures:state.consecutive_failures,
      last_success_at:state.last_success_at,
      last_failure_at:state.last_failure_at,
      error:error?safeError(error):(value?.error?clean(value.error):null),
      details:Object.freeze(clone(value&&typeof value==='object'?value:{value})),
      observability_not_authority:true,
      authority_effect:false,
    });
  }

  async function snapshot({company_id=null}={}){
    const activeCompanyId=clean(company_id)||null;
    const entries=await Promise.all([...registrations.values()].map(registration=>runProbe(registration,{company_id:activeCompanyId})));
    const probes=Object.fromEntries(entries.map(entry=>[entry.id,entry]));
    const status=overallStatus(probes);
    return Object.freeze({
      schema:'titan.observability.runtime-health.v1',
      company_id:activeCompanyId,
      companyBoundary:'company_id',
      generated_at:Number(clock()),
      status,
      ok:status==='healthy',
      probeCount:entries.length,
      probes:Object.freeze(probes),
      observability_not_authority:true,
      grants_authority:false,
      authority_effect:false,
    });
  }

  return Object.freeze({registerProbe,list,snapshot,observability_not_authority:true,authority_effect:false});
}
