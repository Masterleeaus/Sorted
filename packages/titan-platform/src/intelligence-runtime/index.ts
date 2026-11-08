export type IntelligenceLocality = 'device'|'customer_edge'|'local_bridge'|'byo'|'customer_service'|'titan_entitled'|'titan_metered';
export type PrivacyClass = 'public'|'internal'|'confidential'|'restricted';
export type IntelligenceCapability = 'chat'|'reasoning'|'vision'|'voice'|'embeddings'|'rag'|'tools';

export interface IntelligenceProvider { id:string; company_id:string; locality:IntelligenceLocality; capabilities:IntelligenceCapability[]; external:boolean; titanFunded:boolean; metered:boolean; enabled:boolean; revoked?:boolean; revision?:number; }
export interface IntelligenceModel { id:string; providerId:string; company_id:string; capabilities:IntelligenceCapability[]; contextWindow?:number; enabled:boolean; revoked?:boolean; revision?:number; }
export interface IntelligenceRequest { company_id:string; capability:IntelligenceCapability; privacy:PrivacyClass; freeTier?:boolean; allowExternal?:boolean; allowTitanManaged?:boolean; allowMetered?:boolean; entitlementIds?:string[]; context?:Record<string,unknown>; }
export interface IntelligenceRoute { provider:IntelligenceProvider; model:IntelligenceModel; rank:number; reasons:string[]; authorityGranted:false; }
export interface IntelligenceReceipt { company_id:string; providerId:string; modelId:string; locality:IntelligenceLocality; externalEgress:boolean; titanFunded:boolean; metered:boolean; authorityGranted:false; reasons:string[]; }

const rank:Record<IntelligenceLocality,number>={device:0,customer_edge:1,local_bridge:2,byo:3,customer_service:4,titan_entitled:5,titan_metered:6};
export interface IntelligenceRegistrySnapshot { schema:'titan-intelligence-registry/v1'; company_id:string; providers:IntelligenceProvider[]; models:IntelligenceModel[]; }
function registryKey(company_id:string,id:string){if(!company_id)throw new Error('company_id-required');if(!id)throw new Error('registry-id-required');return `${company_id}:${id}`;}
function stableCapabilities(values:IntelligenceCapability[]){return [...new Set(values)].sort() as IntelligenceCapability[];}
export class IntelligenceProviderRegistry {
 private items=new Map<string,IntelligenceProvider>();
 register(v:IntelligenceProvider){const key=registryKey(v.company_id,v.id),prev=this.items.get(key);const next=Object.freeze({...v,capabilities:stableCapabilities(v.capabilities),revision:v.revision??((prev?.revision||0)+1)});if(prev&&JSON.stringify({...prev,revision:next.revision})===JSON.stringify(next))return prev;this.items.set(key,next);return next;}
 get(company_id:string,id:string){return this.items.get(registryKey(company_id,id));}
 list(company_id:string){return [...this.items.values()].filter(v=>v.company_id===company_id&&v.enabled&&!v.revoked).sort((a,b)=>a.id.localeCompare(b.id));}
 all(company_id:string){return [...this.items.values()].filter(v=>v.company_id===company_id).sort((a,b)=>a.id.localeCompare(b.id));}
 revoke(company_id:string,id:string){const prev=this.get(company_id,id);if(!prev)throw new Error('provider-not-found');return this.register({...prev,enabled:false,revoked:true,revision:(prev.revision||0)+1});}
}
export class IntelligenceModelRegistry {
 private items=new Map<string,IntelligenceModel>();
 register(v:IntelligenceModel){const key=registryKey(v.company_id,v.id),prev=this.items.get(key);const next=Object.freeze({...v,capabilities:stableCapabilities(v.capabilities),revision:v.revision??((prev?.revision||0)+1)});this.items.set(key,next);return next;}
 get(company_id:string,id:string){return this.items.get(registryKey(company_id,id));}
 list(company_id:string){return [...this.items.values()].filter(v=>v.company_id===company_id&&v.enabled&&!v.revoked).sort((a,b)=>a.id.localeCompare(b.id));}
 all(company_id:string){return [...this.items.values()].filter(v=>v.company_id===company_id).sort((a,b)=>a.id.localeCompare(b.id));}
 revoke(company_id:string,id:string){const prev=this.get(company_id,id);if(!prev)throw new Error('model-not-found');return this.register({...prev,enabled:false,revoked:true,revision:(prev.revision||0)+1});}
}
export function exportIntelligenceRegistry(company_id:string,providers:IntelligenceProviderRegistry,models:IntelligenceModelRegistry):IntelligenceRegistrySnapshot{return {schema:'titan-intelligence-registry/v1',company_id,providers:providers.all(company_id).map(v=>({...v})),models:models.all(company_id).map(v=>({...v}))};}
export function importIntelligenceRegistry(snapshot:IntelligenceRegistrySnapshot,company_id:string,providers:IntelligenceProviderRegistry,models:IntelligenceModelRegistry){if(snapshot?.schema!=='titan-intelligence-registry/v1')throw new Error('registry-schema-invalid');if(snapshot.company_id!==company_id)throw new Error('registry-cross-company-import-denied');for(const p of snapshot.providers||[]){if(p.company_id!==company_id)throw new Error('registry-cross-company-provider-denied');providers.register(p);}for(const m of snapshot.models||[]){if(m.company_id!==company_id)throw new Error('registry-cross-company-model-denied');models.register(m);}return {providers:providers.all(company_id).length,models:models.all(company_id).length};}

export function evaluateExecutionPolicy(req:IntelligenceRequest,p:IntelligenceProvider):string[] {
 const deny:string[]=[];
 if(p.company_id!==req.company_id) deny.push('cross-company');
 if(!p.capabilities.includes(req.capability)) deny.push('capability-mismatch');
 if(p.external && req.allowExternal!==true) deny.push('external-egress-not-approved');
 if(req.privacy==='restricted' && p.external) deny.push('restricted-data-egress');
 if(p.titanFunded && req.freeTier) deny.push('free-tier-titan-funded-denied');
 if(p.locality==='titan_entitled' && req.allowTitanManaged!==true) deny.push('titan-managed-not-approved');
 if(p.metered && req.allowMetered!==true) deny.push('metered-escalation-not-approved');
 return deny;
}
export function minimiseContext(context:Record<string,unknown>|undefined, allowedKeys:string[]=[]):Record<string,unknown>{if(!context)return {}; if(!allowedKeys.length)return {}; return Object.fromEntries(Object.entries(context).filter(([k])=>allowedKeys.includes(k)));}
export function redactContext(context:Record<string,unknown>):Record<string,unknown>{const secret=/token|secret|password|api[_-]?key|authorization/i; return Object.fromEntries(Object.entries(context).map(([k,v])=>[k,secret.test(k)?'[REDACTED]':v]));}

export class IntelligenceRouter {
 constructor(private providers:IntelligenceProviderRegistry,private models:IntelligenceModelRegistry){}
 route(req:IntelligenceRequest, excludedProviderIds:ReadonlySet<string>=new Set()):IntelligenceRoute {
  const models=this.models.list(req.company_id);
  const candidates=this.providers.list(req.company_id).filter(p=>!excludedProviderIds.has(p.id)).flatMap(p=>models.filter(m=>m.providerId===p.id&&m.capabilities.includes(req.capability)).map(model=>({p,model,deny:evaluateExecutionPolicy(req,p)}))).filter(x=>x.deny.length===0).sort((a,b)=>rank[a.p.locality]-rank[b.p.locality]);
  const winner=candidates[0]; if(!winner)throw new Error('no-governed-intelligence-route');
  return {provider:winner.p,model:winner.model,rank:rank[winner.p.locality],reasons:[`locality:${winner.p.locality}`,'policy:allowed'],authorityGranted:false};
 }
 receipt(req:IntelligenceRequest,route:IntelligenceRoute):IntelligenceReceipt{return {company_id:req.company_id,providerId:route.provider.id,modelId:route.model.id,locality:route.provider.locality,externalEgress:route.provider.external,titanFunded:route.provider.titanFunded,metered:route.provider.metered,authorityGranted:false,reasons:route.reasons};}
}

export * from './execution.js';
export * from './device-runtime.js';

export * from './resource-reporting.js';

export * from './edge-advertisement.js';

export * from './context-budget.js';
