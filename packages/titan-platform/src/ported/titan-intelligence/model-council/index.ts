export type ModelCouncilVote=Readonly<{provider_id:string;recommendation:string;confidence:number;evidence_refs?:readonly string[];company_id?:string}>;
const clean=(v:unknown,n:string)=>{const s=String(v??"").trim();if(!s)throw new TypeError(`${n}-required`);return s;};

export function buildModelCouncilRecommendation(input:{company_id:string;votes:readonly ModelCouncilVote[]}) {
 const company_id=clean(input.company_id,"company_id");
 const votes=[...(input.votes??[])].map(v=>{ if(v.company_id!=null&&clean(v.company_id,"company_id")!==company_id) throw new Error("model-council-company-mismatch"); return Object.freeze({
   provider_id:clean(v.provider_id,"provider-id"),
   recommendation:clean(v.recommendation,"recommendation"),
   confidence:Math.max(0,Math.min(1,Number.isFinite(Number(v.confidence))?Number(v.confidence):0)),
   evidence_refs:Object.freeze([...(v.evidence_refs??[])].map(String).sort()),
 }); }).sort((a,b)=>b.confidence-a.confidence||a.provider_id.localeCompare(b.provider_id));
 const groups=new Map<string,{count:number;confidence:number}>();
 for(const v of votes){const g=groups.get(v.recommendation)??{count:0,confidence:0};g.count++;g.confidence+=v.confidence;groups.set(v.recommendation,g);}
 const consensus=[...groups.entries()].sort((a,b)=>b[1].count-a[1].count||b[1].confidence-a[1].confidence||a[0].localeCompare(b[0]))[0]?.[0]??null;
 return Object.freeze({company_id,votes:Object.freeze(votes),consensus,authority_neutral:true as const,execution_authority:false as const,recommendation_is_authority:false as const,consensus_is_authority:false as const,authority_conferred_by_activation:false as const});
}

export const MODEL_COUNCIL_POLICY=Object.freeze({tenant_boundary:"company_id" as const,deterministic:true as const,consensus_is_authority:false as const,execution_authority:false as const});
