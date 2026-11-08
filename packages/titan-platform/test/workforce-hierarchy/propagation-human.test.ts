import {bindHumanParticipant,attachHumanToWork} from "../../src/workforce-hierarchy/index.js";
const h=bindHumanParticipant({company_id:"c1",human_actor_ref:"user:1",role_ref:"owner",participation:"approve"});
const b=attachHumanToWork({company_id:"c1",human:h,accountable_agent_id:"TZAG-X",correlation_id:"corr-1"});
if(b.human_is_substitute_agent!==false||b.authority_granted!==false)throw new Error("human-boundary-failed");
let rejected=false;try{bindHumanParticipant({company_id:"c1",human_actor_ref:"user:1",role_ref:"owner",participation:"approve",agent_id:"TZAG-X"} as any)}catch{rejected=true}
if(!rejected)throw new Error("human-agent-substitution-not-rejected");
let cross=false;try{attachHumanToWork({company_id:"c2",human:h,accountable_agent_id:"TZAG-X",correlation_id:"corr-2"})}catch{cross=true}
if(!cross)throw new Error("cross-company-human-binding-not-rejected");
