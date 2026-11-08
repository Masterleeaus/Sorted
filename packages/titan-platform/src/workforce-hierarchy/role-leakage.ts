import type {ResponsibilityContract,WorkforcePosition} from "./responsibility.js";
const rank:Record<WorkforcePosition,number>={Orchestrator:0,Manager:1,Specialist:2,Worker:3};
export type RoleLeakageCheck={ok:boolean;violations:readonly string[];authority_granted:false;grants_authority:false;authority_effect:false};
export function validateRoleBoundary(owner:ResponsibilityContract,actor:ResponsibilityContract):RoleLeakageCheck{
 const violations:string[]=[];
 if(owner.company_id!==actor.company_id)violations.push("cross-company-responsibility-leakage");
 if(owner.agent_id!==actor.agent_id){
  if(owner.position==="Worker"&&actor.position!=="Worker")violations.push("bounded-worker-responsibility-substitution");
  if(rank[actor.position]>rank[owner.position]&&owner.responsibility_kind!=="bounded_execution")violations.push("down-tier-outcome-ownership-leakage");
  const overlap=owner.outcome_ids.filter(x=>actor.outcome_ids.includes(x));
  if(overlap.length)violations.push("canonical-outcome-owner-collision");
 }
 return Object.freeze({ok:violations.length===0,violations:Object.freeze(violations),
  authority_granted:false as const,grants_authority:false as const,authority_effect:false as const});
}
export function assertRoleBoundary(owner:ResponsibilityContract,actor:ResponsibilityContract){
 const r=validateRoleBoundary(owner,actor);if(!r.ok)throw new Error(`workforce-role-leakage:${r.violations.join(",")}`);return r;
}
