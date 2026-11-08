import type { IntelligenceRequest, IntelligenceRoute, IntelligenceReceipt, IntelligenceLocality } from './index.js';
import { IntelligenceRouter, minimiseContext, redactContext } from './index.js';

export interface IntelligenceExecutionInput extends IntelligenceRequest {
  messages?: Array<{role:'system'|'user'|'assistant';content:string}>;
  allowedContextKeys?: string[];
}
export interface ProviderExecutionResult { content:string; usage?:Record<string,number>; metadata?:Record<string,unknown>; }
export interface IntelligenceProviderAdapter {
  providerId:string;
  locality:IntelligenceLocality;
  health():Promise<{available:boolean;reason?:string}>;
  execute(input:{request:IntelligenceExecutionInput;route:IntelligenceRoute;context:Record<string,unknown>}):Promise<ProviderExecutionResult>;
}
export interface IntelligenceExecutionReceipt extends IntelligenceReceipt {
  attemptedProviderIds:string[];
  fallbackCount:number;
  status:'SUCCEEDED'|'FAILED';
  failureReasons:string[];
}
export interface IntelligenceExecutionResult { result:ProviderExecutionResult; route:IntelligenceRoute; receipt:IntelligenceExecutionReceipt; context:Record<string,unknown>; authorityGranted:false; }

export class IntelligenceAdapterRegistry {
  private adapters=new Map<string,IntelligenceProviderAdapter>();
  register(adapter:IntelligenceProviderAdapter){this.adapters.set(adapter.providerId,adapter);}
  get(providerId:string){return this.adapters.get(providerId);}
}

export class GovernedIntelligenceExecutor {
  constructor(private router:IntelligenceRouter,private adapters:IntelligenceAdapterRegistry){}
  async execute(input:IntelligenceExecutionInput):Promise<IntelligenceExecutionResult>{
    const excluded=new Set<string>(); const attempted:string[]=[]; const failures:string[]=[];
    const context=redactContext(minimiseContext(input.context,input.allowedContextKeys));
    for(;;){
      let route:IntelligenceRoute;
      try{route=this.router.route(input,excluded);}catch(error){throw new Error(`intelligence-execution-exhausted:${failures.join('|')||String((error as Error).message)}`);}
      const adapter=this.adapters.get(route.provider.id); excluded.add(route.provider.id); attempted.push(route.provider.id);
      if(!adapter){failures.push(`${route.provider.id}:adapter-unavailable`);continue;}
      if(adapter.locality!==route.provider.locality){failures.push(`${route.provider.id}:adapter-locality-mismatch`);continue;}
      try{
        const health=await adapter.health(); if(!health.available){failures.push(`${route.provider.id}:${health.reason||'unhealthy'}`);continue;}
        const result=await adapter.execute({request:input,route,context});
        const base=this.router.receipt(input,route);
        return {result,route,context,authorityGranted:false,receipt:{...base,attemptedProviderIds:attempted,fallbackCount:attempted.length-1,status:'SUCCEEDED',failureReasons:failures}};
      }catch(error){failures.push(`${route.provider.id}:${String((error as Error).message||error)}`);}
    }
  }
}

export interface OllamaAdapterOptions { providerId?:string; endpoint?:string; timeoutMs?:number; fetchImpl?:typeof fetch; }
function loopbackEndpoint(value:string|undefined){const raw=String(value||'http://127.0.0.1:11434').replace(/\/+$/,''); const u=new URL(raw); if(u.protocol!=='http:'||!['127.0.0.1','localhost','::1','[::1]'].includes(u.hostname.toLowerCase()))throw new Error('ollama-loopback-endpoint-required'); return `${u.protocol}//${u.host}`;}
export class OllamaIntelligenceAdapter implements IntelligenceProviderAdapter {
  providerId:string; locality:IntelligenceLocality='local_bridge'; private endpoint:string; private timeoutMs:number; private fetchImpl:typeof fetch;
  constructor(options:OllamaAdapterOptions={}){this.providerId=options.providerId||'ollama';this.endpoint=loopbackEndpoint(options.endpoint);this.timeoutMs=Math.max(250,Math.min(120000,options.timeoutMs||30000));this.fetchImpl=options.fetchImpl||globalThis.fetch;}
  private async call(path:string,init?:RequestInit){if(typeof this.fetchImpl!=='function')throw new Error('fetch-unavailable');const c=new AbortController();const t=setTimeout(()=>c.abort(),this.timeoutMs);try{const r=await this.fetchImpl(`${this.endpoint}${path}`,{...init,signal:c.signal});if(!r.ok)throw new Error(`http-${r.status}`);return await r.json();}finally{clearTimeout(t);}}
  async health(){try{await this.call('/api/version');return {available:true};}catch(error){return {available:false,reason:String((error as Error).message||error)};}}
  async execute({request,route}:{request:IntelligenceExecutionInput;route:IntelligenceRoute;context:Record<string,unknown>}){const messages=(request.messages||[]).slice(-32).map(m=>({role:m.role,content:String(m.content).slice(0,12000)}));if(!messages.length)throw new Error('ollama-messages-required');const data:any=await this.call('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:route.model.id,messages,stream:false})});return {content:String(data?.message?.content||''),usage:{promptEvalCount:Number(data?.prompt_eval_count)||0,evalCount:Number(data?.eval_count)||0},metadata:{local:true}};}
}

export type ProviderCircuitState='CLOSED'|'OPEN'|'HALF_OPEN';
export interface ProviderHealthSnapshot { providerId:string; state:ProviderCircuitState; consecutiveFailures:number; openedAt?:number; lastFailureAt?:number; lastSuccessAt?:number; }
export class IntelligenceProviderHealthRegistry {
  private state=new Map<string,ProviderHealthSnapshot>();
  constructor(private failureThreshold=3,private cooldownMs=30_000){}
  snapshot(providerId:string):ProviderHealthSnapshot{return {...(this.state.get(providerId)||{providerId,state:'CLOSED',consecutiveFailures:0})};}
  canAttempt(providerId:string,now=Date.now()){const s=this.snapshot(providerId);if(s.state!=='OPEN')return true;if(!s.openedAt||now-s.openedAt<this.cooldownMs)return false;this.state.set(providerId,{...s,state:'HALF_OPEN'});return true;}
  success(providerId:string,now=Date.now()){this.state.set(providerId,{providerId,state:'CLOSED',consecutiveFailures:0,lastSuccessAt:now});}
  failure(providerId:string,now=Date.now()){const s=this.snapshot(providerId);const n=s.consecutiveFailures+1;this.state.set(providerId,{...s,providerId,consecutiveFailures:n,lastFailureAt:now,state:n>=this.failureThreshold?'OPEN':'CLOSED',...(n>=this.failureThreshold?{openedAt:now}:{})});}
}

export interface IntelligenceTelemetryEvent { type:'intelligence.execution'; company_id:string; status:'SUCCEEDED'|'FAILED'; providerId?:string; modelId?:string; locality?:IntelligenceLocality; attemptedProviderIds:string[]; fallbackCount:number; failureReasons:string[]; externalEgress?:boolean; titanFunded?:boolean; metered?:boolean; authorityGranted:false; timestamp:string; }
export interface IntelligenceTelemetrySink { emit(event:IntelligenceTelemetryEvent):void|Promise<void>; }
export class InMemoryIntelligenceTelemetrySink implements IntelligenceTelemetrySink { readonly events:IntelligenceTelemetryEvent[]=[]; emit(event:IntelligenceTelemetryEvent){this.events.push(Object.freeze({...event,attemptedProviderIds:[...event.attemptedProviderIds],failureReasons:[...event.failureReasons]}));} }

export interface DiscoveredIntelligenceModel { id:string; providerId:string; capabilities?:string[]; sizeBytes?:number; modifiedAt?:string; metadata?:Record<string,unknown>; }
export interface DiscoverableIntelligenceProviderAdapter extends IntelligenceProviderAdapter { discoverModels():Promise<DiscoveredIntelligenceModel[]>; }

export class ResilientGovernedIntelligenceExecutor {
  constructor(private router:IntelligenceRouter,private adapters:IntelligenceAdapterRegistry,private health=new IntelligenceProviderHealthRegistry(),private telemetry?:IntelligenceTelemetrySink){}
  async execute(input:IntelligenceExecutionInput):Promise<IntelligenceExecutionResult>{
    const excluded=new Set<string>(),attempted:string[]=[],failures:string[]=[];const context=redactContext(minimiseContext(input.context,input.allowedContextKeys));
    for(;;){
      let route:IntelligenceRoute;
      try{route=this.router.route(input,excluded);}catch(error){const event:IntelligenceTelemetryEvent={type:'intelligence.execution',company_id:input.company_id,status:'FAILED',attemptedProviderIds:attempted,fallbackCount:Math.max(0,attempted.length-1),failureReasons:failures.length?failures:[String((error as Error).message)],authorityGranted:false,timestamp:new Date().toISOString()};await this.telemetry?.emit(event);throw new Error(`intelligence-execution-exhausted:${event.failureReasons.join('|')}`);}
      const id=route.provider.id;if(!this.health.canAttempt(id)){excluded.add(id);failures.push(`${id}:circuit-open`);continue;}
      const adapter=this.adapters.get(id);excluded.add(id);attempted.push(id);
      if(!adapter){this.health.failure(id);failures.push(`${id}:adapter-unavailable`);continue;}
      if(adapter.locality!==route.provider.locality){this.health.failure(id);failures.push(`${id}:adapter-locality-mismatch`);continue;}
      try{const h=await adapter.health();if(!h.available){this.health.failure(id);failures.push(`${id}:${h.reason||'unhealthy'}`);continue;}const result=await adapter.execute({request:input,route,context});this.health.success(id);const base=this.router.receipt(input,route);const receipt:IntelligenceExecutionReceipt={...base,attemptedProviderIds:attempted,fallbackCount:attempted.length-1,status:'SUCCEEDED',failureReasons:failures};await this.telemetry?.emit({type:'intelligence.execution',company_id:input.company_id,status:'SUCCEEDED',providerId:id,modelId:route.model.id,locality:route.provider.locality,attemptedProviderIds:attempted,fallbackCount:receipt.fallbackCount,failureReasons:failures,externalEgress:base.externalEgress,titanFunded:base.titanFunded,metered:base.metered,authorityGranted:false,timestamp:new Date().toISOString()});return {result,route,receipt,context,authorityGranted:false};}catch(error){this.health.failure(id);failures.push(`${id}:${String((error as Error).message||error)}`);}
    }
  }
}

export class DiscoverableOllamaIntelligenceAdapter extends OllamaIntelligenceAdapter implements DiscoverableIntelligenceProviderAdapter {
  async discoverModels():Promise<DiscoveredIntelligenceModel[]>{const self=this as any;const data:any=await self.call('/api/tags');return (Array.isArray(data?.models)?data.models:[]).map((m:any)=>({id:String(m?.name||m?.model||''),providerId:this.providerId,sizeBytes:Number(m?.size)||undefined,modifiedAt:m?.modified_at?String(m.modified_at):undefined,metadata:{digest:m?.digest,details:m?.details}})).filter((m:DiscoveredIntelligenceModel)=>Boolean(m.id));}
}
