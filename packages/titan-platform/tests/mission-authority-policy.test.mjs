import test from "node:test";
import assert from "node:assert/strict";
import { compileMissionAuthorityPolicy, evaluateMissionAuthorityPolicy, projectMissionAuthorityLimits } from "../.test-dist/mission-authority-policy.js";

const input = { company_id:"co-1", policy_id:"pol-1", version:1, statement:"Jobs over 5000 require approval", source_ref:"human:brief-1", author_id:"owner", approver_id:"manager", scope:{mission_id:"m-1",agent_ids:["a-1"]}, effective_from:"2026-01-01T00:00:00Z", rules:[{kind:"max_amount",currency:"AUD",amount:5000},{kind:"requires_approval",operation:"pay"},{kind:"allowed_capabilities",capabilities:["billing"]}] };
test("compiles policy and allows exact boundary",()=>{const p=compileMissionAuthorityPolicy(input); const r=evaluateMissionAuthorityPolicy(p,{company_id:"co-1",mission_id:"m-1",agent_id:"a-1",operation:"read",capability:"billing",amount:5000,currency:"AUD",now:"2026-02-01T00:00:00Z",mission_state:"active"}); assert.equal(r.decision,"allow");});
test("denies over limit and scope/revocation",()=>{const p=compileMissionAuthorityPolicy(input); assert.equal(evaluateMissionAuthorityPolicy(p,{company_id:"co-1",mission_id:"m-1",agent_id:"a-1",operation:"read",capability:"billing",amount:5001,currency:"AUD",now:"2026-02-01T00:00:00Z"}).reason,"amount-limit-exceeded"); assert.equal(evaluateMissionAuthorityPolicy(p,{company_id:"co-1",mission_id:"m-1",agent_id:"a-1",operation:"read",capability:"billing",now:"2026-02-01T00:00:00Z",revoked:true}).reason,"policy-revoked");});
test("requires approval without widening authority",()=>{const p=compileMissionAuthorityPolicy(input); assert.equal(evaluateMissionAuthorityPolicy(p,{company_id:"co-1",mission_id:"m-1",agent_id:"a-1",operation:"pay",capability:"billing",amount:5000,currency:"AUD",now:"2026-02-01T00:00:00Z"}).decision,"approval_required"); assert.throws(()=>compileMissionAuthorityPolicy({...input,author_id:"same",approver_id:"same"}),/author-cannot-approve-own-policy/);});


test("compiles provider-cost and communication ceilings without granting authority",()=>{
 const p=compileMissionAuthorityPolicy({...input,rules:[
  ...input.rules,
  {kind:"max_provider_cost",currency:"AUD",amount:12},
  {kind:"max_messages",count:2},
  {kind:"max_recipients",count:3},
 ]});
 assert.deepEqual(projectMissionAuthorityLimits(p),{currency:"AUD",max_amount:5000,max_provider_cost:12,max_messages:2,max_recipients:3});
 assert.equal(evaluateMissionAuthorityPolicy(p,{company_id:"co-1",mission_id:"m-1",agent_id:"a-1",operation:"read",capability:"billing",amount:5000,provider_cost:12,messages:2,recipients:3,currency:"AUD",now:"2026-02-01T00:00:00Z"}).decision,"allow");
 assert.equal(evaluateMissionAuthorityPolicy(p,{company_id:"co-1",mission_id:"m-1",agent_id:"a-1",operation:"read",capability:"billing",amount:5000,provider_cost:12.01,messages:2,recipients:3,currency:"AUD",now:"2026-02-01T00:00:00Z"}).reason,"provider-cost-limit-exceeded");
 assert.equal(evaluateMissionAuthorityPolicy(p,{company_id:"co-1",mission_id:"m-1",agent_id:"a-1",operation:"read",capability:"billing",amount:5000,provider_cost:12,messages:3,recipients:3,currency:"AUD",now:"2026-02-01T00:00:00Z"}).reason,"message-limit-exceeded");
 assert.equal(evaluateMissionAuthorityPolicy(p,{company_id:"co-1",mission_id:"m-1",agent_id:"a-1",operation:"read",capability:"billing",amount:5000,provider_cost:12,messages:2,recipients:4,currency:"AUD",now:"2026-02-01T00:00:00Z"}).reason,"recipient-limit-exceeded");
});
