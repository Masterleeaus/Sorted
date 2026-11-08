import {createResponsibilityContract,validateRoleBoundary} from "../../src/workforce-hierarchy/index.js";
const worker=createResponsibilityContract({company_id:"c1",agent_id:"w1",position:"Worker",responsibility_kind:"bounded_execution",pain_ids:["p1"],outcome_ids:["o1"],domain_refs:["field"]});
const specialist=createResponsibilityContract({company_id:"c1",agent_id:"s1",position:"Specialist",responsibility_kind:"complex_judgement",pain_ids:["p2"],outcome_ids:["o2"],domain_refs:["field"]});
if(!validateRoleBoundary(specialist,worker).ok) throw new Error("valid-boundary-rejected");
let mismatch=false;try{createResponsibilityContract({company_id:"c1",agent_id:"w2",position:"Worker",responsibility_kind:"outcome_family" as any,pain_ids:["p"],outcome_ids:["o"],domain_refs:["field"]})}catch{mismatch=true}
if(!mismatch)throw new Error("tier-mismatch-not-rejected");
if(worker.authority_granted!==false||worker.grants_authority!==false)throw new Error("responsibility-granted-authority");
