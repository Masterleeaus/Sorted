export type CounterfactualBranch={schema:"titan.counterfactual-branch.v1";branch_id:string;company_id:string;parent_evidence_checkpoint:string;assumptions:readonly string[];provenance_ref:string;classification:"COUNTERFACTUAL";authority_granted:false;created_at:string};
export type CounterfactualIntent={company_id:string;branch_id:string;parent_evidence_checkpoint:string;real_intent_id:string;authority_decision_ref:string;classification:"FACTUAL_INTENT";authority_granted:false};
const req=(v:unknown,n:string)=>{const x=String(v??"").trim();if(!x)throw new Error(`${n}-required`);return x;};
export function createCounterfactualBranch(input:{branch_id:string;company_id:string;parent_evidence_checkpoint:string;assumptions:string[];provenance_ref:string;created_at?:string}):CounterfactualBranch{
 const created_at=input.created_at??new Date().toISOString(); if(!Number.isFinite(Date.parse(created_at)))throw new Error("created_at-invalid");
 const assumptions=[...new Set(input.assumptions.map(v=>req(v,"assumption")))]; if(!assumptions.length)throw new Error("assumptions-required");
 return Object.freeze({schema:"titan.counterfactual-branch.v1",branch_id:req(input.branch_id,"branch_id"),company_id:req(input.company_id,"company_id"),parent_evidence_checkpoint:req(input.parent_evidence_checkpoint,"parent_evidence_checkpoint"),assumptions:Object.freeze(assumptions),provenance_ref:req(input.provenance_ref,"provenance_ref"),classification:"COUNTERFACTUAL",authority_granted:false,created_at});
}
export function compareCounterfactualBranches(branches:readonly CounterfactualBranch[],company_id:string,parent_evidence_checkpoint?:string):{branch_ids:readonly string[];isolated:true;parent_evidence_checkpoint:string}{
 const company=req(company_id,"company_id"); if(!branches.length)throw new Error("branches-required"); if(branches.some(b=>b.company_id!==company))throw new Error("branch-company-mismatch"); const checkpoint=req(parent_evidence_checkpoint??branches[0].parent_evidence_checkpoint,"parent_evidence_checkpoint"); if(branches.some(b=>b.parent_evidence_checkpoint!==checkpoint))throw new Error("checkpoint-mismatch"); const ids=branches.map(b=>b.branch_id); if(new Set(ids).size!==ids.length)throw new Error("branch-id-duplicate"); return Object.freeze({branch_ids:Object.freeze(ids),isolated:true as const,parent_evidence_checkpoint:checkpoint});
}
export function assertCounterfactualCannotEnterFactual(record:{classification?:string;authority_granted?:boolean}){if(record.classification!=="COUNTERFACTUAL")throw new Error("counterfactual-classification-required");if(record.authority_granted===true)throw new Error("counterfactual-authority-forbidden");return true;}
export function promoteCounterfactualIntent(branch:CounterfactualBranch,input:{company_id:string;parent_evidence_checkpoint:string;real_intent_id:string;authority_decision_ref:string}):CounterfactualIntent{
 if(input.company_id!==branch.company_id)throw new Error("company-mismatch");
 if(input.parent_evidence_checkpoint!==branch.parent_evidence_checkpoint)throw new Error("checkpoint-mismatch");
 assertCounterfactualCannotEnterFactual(branch);
 return Object.freeze({company_id:branch.company_id,branch_id:branch.branch_id,parent_evidence_checkpoint:branch.parent_evidence_checkpoint,real_intent_id:req(input.real_intent_id,"real_intent_id"),authority_decision_ref:req(input.authority_decision_ref,"authority_decision_ref"),classification:"FACTUAL_INTENT",authority_granted:false});
}

