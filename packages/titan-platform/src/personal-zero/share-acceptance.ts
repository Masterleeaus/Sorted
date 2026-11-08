import type { CrossContextShareGrant } from "./contracts.js";

export type TargetShareAcceptance=Readonly<{
 schema:"titan.personal-zero.target-share-acceptance.v1";
 acceptance_id:string;grant_id:string;grant_fingerprint:string;
 one_id:string;zero_id:string;target_company_id:string;target_relationship_id:string;
 accepted_subject_refs:readonly string[];purpose:string;accepted_at:number;expires_at:number|null;revoked_at:number|null;
 authority_neutral:true;execution_authority:false;
}>;

const id=(v:unknown,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(n+" is required");return x};
export function shareGrantFingerprint(grant:Pick<CrossContextShareGrant,"grant_id"|"one_id"|"zero_id"|"source_company_id"|"source_relationship_id"|"target_company_id"|"target_relationship_id"|"subject_refs"|"purpose"|"consent_ref"|"expires_at">){
 return [grant.grant_id,grant.one_id,grant.zero_id,grant.source_company_id,grant.source_relationship_id,grant.target_company_id,grant.target_relationship_id,[...grant.subject_refs].sort().join(","),grant.purpose,grant.consent_ref,String(grant.expires_at??"")].join("|");
}
export function createTargetShareAcceptance(input:Omit<TargetShareAcceptance,"schema"|"authority_neutral"|"execution_authority">):TargetShareAcceptance{
 if(!input.accepted_subject_refs.length)throw new Error("Target acceptance requires accepted_subject_refs");
 return Object.freeze({...input,schema:"titan.personal-zero.target-share-acceptance.v1",acceptance_id:id(input.acceptance_id,"acceptance_id"),grant_id:id(input.grant_id,"grant_id"),grant_fingerprint:id(input.grant_fingerprint,"grant_fingerprint"),one_id:id(input.one_id,"one_id"),zero_id:id(input.zero_id,"zero_id"),target_company_id:id(input.target_company_id,"target_company_id"),target_relationship_id:id(input.target_relationship_id,"target_relationship_id"),accepted_subject_refs:Object.freeze([...input.accepted_subject_refs]),purpose:id(input.purpose,"purpose"),authority_neutral:true,execution_authority:false});
}
export function validateTargetShareAcceptance(grant:CrossContextShareGrant,acceptance:TargetShareAcceptance,now=Date.now()){
 if(acceptance.revoked_at!=null||(acceptance.expires_at!=null&&acceptance.expires_at<=now))return false;
 if(acceptance.grant_id!==grant.grant_id||acceptance.grant_fingerprint!==shareGrantFingerprint(grant))return false;
 if(acceptance.one_id!==grant.one_id||acceptance.zero_id!==grant.zero_id||acceptance.target_company_id!==grant.target_company_id||acceptance.target_relationship_id!==grant.target_relationship_id||acceptance.purpose!==grant.purpose)return false;
 return grant.subject_refs.every(x=>acceptance.accepted_subject_refs.includes(x));
}
