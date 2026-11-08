export type WorkforceSurface="zero"|"go"|"hub";
export type WorkforcePosition="Orchestrator"|"Manager"|"Specialist"|"Worker";
export type WorkforcePresentationInput={
 company_id:string;agent_id:string;canonical_name:string;position:WorkforcePosition;surface:WorkforceSurface;
 purpose:string;outcome_ids?:string[];pain_point_ids?:string[];capability_ids?:string[];
 signals?:Array<{id:string;label:string;state?:string;value?:unknown}>;
 actions?:Array<{intent:string;label:string;capability_id?:string}>;
};
const req=(v:string,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(`${n}-required`);return x};
export function normalizeWorkforcePresentationInput(v:WorkforcePresentationInput){
 return Object.freeze({...v,company_id:req(v.company_id,"company_id"),agent_id:req(v.agent_id,"agent_id"),
 canonical_name:req(v.canonical_name,"canonical_name"),purpose:req(v.purpose,"purpose")});
}
