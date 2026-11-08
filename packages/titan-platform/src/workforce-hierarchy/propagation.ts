import type {WorkforcePosition} from "./responsibility.js";
import {getHierarchyNode} from "./hierarchy.js";
const req=(v:string,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(`${n}-required`);return x};
export type UpwardEvidence={company_id:string;source_agent_id:string;target_agent_id:string;outcome_id:string;evidence_refs:readonly string[];correlation_id:string};
export function prepareUpwardEvidence(input:UpwardEvidence){
 const company_id=req(input.company_id,"company_id"),source=getHierarchyNode(req(input.source_agent_id,"source_agent_id")),target=getHierarchyNode(req(input.target_agent_id,"target_agent_id"));
 if(source.parent_agent_id!==target.agent_id)throw new Error("upward-propagation-target-not-canonical-parent");
 const evidence_refs=Object.freeze([...new Set((input.evidence_refs??[]).map(x=>String(x).trim()).filter(Boolean))]);
 if(!evidence_refs.length)throw new Error("upward-propagation-evidence-required");
 return Object.freeze({schema:"titan.workforce.upward-evidence.v1",company_id,source_agent_id:source.agent_id,target_agent_id:target.agent_id,
  outcome_id:req(input.outcome_id,"outcome_id"),evidence_refs,correlation_id:req(input.correlation_id,"correlation_id"),
  propagation_kind:"evidence_and_outcome" as const,execution_requested:false as const,authority_granted:false as const,
  grants_authority:false as const,authority_effect:false as const});
}
