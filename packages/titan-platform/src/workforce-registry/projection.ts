import {assertCompanyBoundary,getRuntimeAgent,type CanonicalSurface} from "./registry.js";
const canonical=(s:string):CanonicalSurface=>{
 const v=String(s??"").trim().toLowerCase();
 if(["zero","command","owner","manager","business","bos"].includes(v))return "zero";
 if(["go","field","worker"].includes(v))return "go";
 if(["hub","customer"].includes(v))return "hub";
 throw new Error("surface-invalid");
};
export function projectCanonicalAgent(input:{company_id:string;agent_id:string;surface:string;host?:string}){
 const company_id=assertCompanyBoundary(input.company_id);const agent=getRuntimeAgent(input.agent_id);const surface=canonical(input.surface);
 return Object.freeze({schema:"titan.workforce.surface-projection.v1",company_id,agent_id:agent.agent_id,
 canonical_name:agent.canonical_name,workforce_position:agent.workforce_position,surface,host:input.host??null,
 identity_source:"canonical-workforce-registry",projection_only:true,creates_identity:false,
 authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false});
}
