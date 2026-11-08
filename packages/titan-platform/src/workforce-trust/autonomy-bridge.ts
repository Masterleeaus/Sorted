import { evaluateUnlockEligibility, type UnlockGateInput, type UnlockTier } from "./unlock-gates.js";
export type AuthorityEvaluationRequest={
 schema:"titan.workforce.authority-evaluation-request.v1"; company_id:string;agent_id:string;capability:string;
 variant:string|null;workflow:string|null;context_ref:string|null;
 tier:UnlockTier; eligibility_ref:string|null; eligible_for_authority_evaluation:boolean;
 authority_owner:"titan-autonomy"; authority_granted:false;execution_permitted:false;grants_authority:false;authority_effect:false;
};
export function createAuthorityEvaluationRequest(input:UnlockGateInput,tier:UnlockTier,eligibility_ref:string|null=null):AuthorityEvaluationRequest{
 const e=evaluateUnlockEligibility(input,tier);
 return Object.freeze({schema:"titan.workforce.authority-evaluation-request.v1",company_id:e.company_id,agent_id:e.agent_id,
 capability:e.capability,variant:e.variant,workflow:e.workflow,context_ref:e.context_ref,tier,eligibility_ref,eligible_for_authority_evaluation:e.eligible_for_authority_evaluation,
 authority_owner:"titan-autonomy",authority_granted:false,execution_permitted:false,grants_authority:false,authority_effect:false});
}
export function assertExternalAutonomySnapshot(request:AuthorityEvaluationRequest,snapshot:any){
 if(!request.eligible_for_authority_evaluation)throw new Error("trust-eligibility-not-met");
 if(!snapshot||snapshot.company_id!==request.company_id)throw new Error("authority-company-mismatch");
 if(snapshot.source!=="titan-autonomy"||snapshot.authority_owner!=="titan-autonomy")throw new Error("authority-owner-invalid");
 if(snapshot.capability!==request.capability)throw new Error("authority-capability-mismatch");
 if((snapshot.variant??null)!==request.variant)throw new Error("authority-variant-mismatch");
 if((snapshot.workflow??null)!==request.workflow)throw new Error("authority-workflow-mismatch");
 if((snapshot.context_ref??null)!==request.context_ref)throw new Error("authority-context-mismatch");
 return snapshot;
}
