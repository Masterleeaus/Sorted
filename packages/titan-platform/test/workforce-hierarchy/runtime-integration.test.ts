import {resolveGovernedWorkforceIdentity,attachRuntimeHuman} from "../../src/workforce-hierarchy/index.js";
const id="TZAG-FIELD-QUALITY-READINESS-MGR";
const x=resolveGovernedWorkforceIdentity("company-1",id);
if(x.company_id!=="company-1"||x.agent_id!==id||x.authority_granted!==false)throw new Error("governed-identity-failed");
const h=attachRuntimeHuman({company_id:"company-1",accountable_agent_id:id,correlation_id:"corr-1",
 human:{company_id:"company-1",human_actor_ref:"user:1",role_ref:"owner",participation:"approve"}});
if(h.work_binding.human_is_substitute_agent!==false||h.authority_granted!==false)throw new Error("runtime-human-boundary-failed");
