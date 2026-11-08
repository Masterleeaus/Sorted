// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/fault-injection-harness.mjs
const FORBIDDEN=new Set(['tenant_id','tenant_company_id','workspace_tenant_id']);
const clone=value=>value==null?value:globalThis.structuredClone?structuredClone(value):JSON.parse(JSON.stringify(value));
const text=(value,field)=>{const out=String(value??'').trim();if(!out)throw new Error(`${field}-required`);return out;};
function rejectLegacy(value,path='fault-injection'){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){value.forEach((child,index)=>rejectLegacy(child,`${path}[${index}]`));return;}
  for(const [key,child] of Object.entries(value)){
    if(FORBIDDEN.has(key))throw new Error(`legacy-company-boundary:${path}.${key}`);
    rejectLegacy(child,`${path}.${key}`);
  }
}
export const FAILURE_KINDS=Object.freeze(['service_worker_restart','storage_unavailable','local_bridge_unavailable','network_unavailable','browser_surface_disconnect']);
export function createFaultInjectionHarness({clock=()=>Date.now()}={}){
  let sequence=0;
  const history=[];
  const normalizeContext=raw=>{
    rejectLegacy(raw,'context');
    return Object.freeze({
      company_id:text(raw?.company_id,'company_id'),
      operation_id:text(raw?.operation_id,'operation_id'),
      correlation_id:String(raw?.correlation_id||raw?.operation_id||'').trim()||null,
      idempotency_key:String(raw?.idempotency_key||'').trim()||null,
    });
  };
  return Object.freeze({
    async inject(rawContext,{kind,run,expect_recoverable=true}={}){
      const ctx=normalizeContext(rawContext);
      const failure_kind=text(kind,'failure-kind');
      if(!FAILURE_KINDS.includes(failure_kind))throw new Error(`unsupported-failure-kind:${failure_kind}`);
      if(typeof run!=='function')throw new Error('failure-runner-required');
      const injected_at=clock(); sequence+=1;
      let outcome='completed',error=null,result=null;
      try{ result=await run(Object.freeze({...ctx,failure_kind,sequence})); }
      catch(err){ outcome='failed'; error=String(err?.message||err); }
      const record=Object.freeze({
        schema:'titan.reliability.fault-injection.v1',
        sequence,failure_kind,company_id:ctx.company_id,operation_id:ctx.operation_id,
        correlation_id:ctx.correlation_id,idempotency_key:ctx.idempotency_key,
        injected_at,outcome,error,expect_recoverable:Boolean(expect_recoverable),
        automatic_effect_replay:false,effect_replay_allowed:false,grants_authority:false,authority_neutral:true,
      });
      history.push(record);
      return Object.freeze({record, result:clone(result)});
    },
    history({company_id=null,correlation_id=null}={}){
      return Object.freeze(history.filter(item=>(!company_id||item.company_id===company_id)&&(!correlation_id||item.correlation_id===correlation_id)).map(clone));
    },
    snapshot(){return Object.freeze({schema:'titan.reliability.fault-injection.snapshot.v1',count:history.length,last_sequence:sequence,grants_authority:false,authority_neutral:true});},
  });
}
