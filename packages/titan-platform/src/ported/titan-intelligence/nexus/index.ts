export type NexusRecommendation=Readonly<{source:string;recommendation:string;evidence_refs?:readonly string[]}>;
const clean=(v:unknown,n:string)=>{const s=String(v??"").trim();if(!s)throw new Error(`${n}-required`);return s;};

export function createNexusOrchestration(input:Readonly<{company_id:string;correlation_id:string;recommendations?:readonly NexusRecommendation[]}>) {
 const company_id=clean(input.company_id,"company_id");
 const correlation_id=clean(input.correlation_id,"correlation_id");
 const recommendations=Object.freeze([...(input.recommendations??[])].map(r=>Object.freeze({
  source:clean(r.source,"source"),
  recommendation:clean(r.recommendation,"recommendation"),
  evidence_refs:Object.freeze([...(r.evidence_refs??[])].map(String).sort())
 })).sort((a,b)=>a.source.localeCompare(b.source)||a.recommendation.localeCompare(b.recommendation)));
 return Object.freeze({company_id,correlation_id,recommendations,authority_neutral:true as const,execution_authority:false as const,orchestration_is_authority:false as const,authority_conferred_by_activation:false as const});
}

export const NEXUS_POLICY=Object.freeze({tenant_boundary:"company_id" as const,deterministic:true as const,orchestration_is_authority:false as const,execution_authority:false as const});
