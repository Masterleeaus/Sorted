import {
 createResponsibilityContract,validateRoleBoundary,bindHumanParticipant,attachHumanToWork,
 resolveGovernedWorkforceIdentity,prepareGovernedDelegation
} from "../../src/workforce-hierarchy/index.js";

const mustReject=(name:string,fn:()=>unknown)=>{let rejected=false;try{fn()}catch{rejected=true}if(!rejected)throw new Error(`${name}-not-rejected`)};

// 1. A tier cannot masquerade as another responsibility kind.
mustReject("worker-manager-role-leakage",()=>createResponsibilityContract({
 company_id:"c1",agent_id:"w1",position:"Worker",responsibility_kind:"outcome_family" as any,
 pain_ids:["p"],outcome_ids:["o"],domain_refs:["field"]
}));

// 2. Orchestrator must actually be cross-domain.
mustReject("orchestrator-single-domain",()=>createResponsibilityContract({
 company_id:"c1",agent_id:"o1",position:"Orchestrator",responsibility_kind:"cross_domain_coordination",
 pain_ids:["p"],outcome_ids:["o"],domain_refs:["field"]
}));

// 3. Human cannot smuggle a canonical agent identity.
mustReject("human-agent-substitution",()=>bindHumanParticipant({
 company_id:"c1",human_actor_ref:"user:1",role_ref:"owner",participation:"approve",agent_id:"TZAG-X"
} as any));

// 4. Human work binding cannot cross company boundary.
const h=bindHumanParticipant({company_id:"c1",human_actor_ref:"user:1",role_ref:"owner",participation:"review"});
mustReject("cross-company-human-binding",()=>attachHumanToWork({
 company_id:"c2",human:h,accountable_agent_id:"TZAG-X",correlation_id:"corr-x"
}));

// 5. Registry identity resolution always remains non-authoritative.
const manager=resolveGovernedWorkforceIdentity("c1","TZAG-FIELD-QUALITY-READINESS-MGR");
if(manager.authority_granted!==false||manager.grants_authority!==false||manager.authority_effect!==false)
 throw new Error("hierarchy-identity-authority-escalation");

// 6. Invalid hierarchy delegation must fail; arbitrary agent pairing is forbidden.
mustReject("noncanonical-delegation-edge",()=>prepareGovernedDelegation({
 company_id:"c1",from_agent_id:"TZAG-FIELD-QUALITY-READINESS-MGR",
 to_agent_id:"TZAG-FIELD-QUALITY-READINESS-MGR",capability_id:"cap-x",scope_ref:"scope-x"
}));

// 7. Outcome ownership collision is detected.
const owner=createResponsibilityContract({company_id:"c1",agent_id:"s1",position:"Specialist",
 responsibility_kind:"complex_judgement",pain_ids:["p1"],outcome_ids:["shared"],domain_refs:["field"]});
const actor=createResponsibilityContract({company_id:"c1",agent_id:"s2",position:"Specialist",
 responsibility_kind:"complex_judgement",pain_ids:["p2"],outcome_ids:["shared"],domain_refs:["field"]});
const collision=validateRoleBoundary(owner,actor);
if(collision.ok||!collision.violations.includes("canonical-outcome-owner-collision"))
 throw new Error("outcome-owner-collision-not-detected");
if(collision.authority_granted!==false||collision.grants_authority!==false)throw new Error("boundary-check-granted-authority");
