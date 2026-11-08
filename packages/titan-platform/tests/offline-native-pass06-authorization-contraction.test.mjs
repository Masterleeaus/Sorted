import test from "node:test";
import assert from "node:assert/strict";
import {createOfflineAuthorizationGate} from "../.test-dist/offline/index.js";

const ctx=(company_id="company-a")=>({company_id,actor_id:"worker-1",operation_id:"op-1"});
const decision=(over={})=>({
  company_id:"company-a",authority_decision_id:"auth-1",worker_id:"worker-1",capability:"jobs.update",
  operation_id:"op-1",action_id:"act-1",decision:"ALLOW",evaluated_at:"2026-09-13T00:00:00.000Z",
  expires_at:"2026-09-13T01:00:00.000Z",effective_score:80,
  permissions:["jobs:write"],entitlements:["field"],context_revision:"ctx-1",account_revision:"acct-1",policy_revision:"pol-1",...over
});
const current={company_id:"company-a",context_revision:"ctx-1",account_revision:"acct-1",policy_revision:"pol-1"};
function gate(){return createOfflineAuthorizationGate({clock:()=>Date.parse("2026-09-13T00:02:00.000Z"),max_policy_age_ms:300000,offline_score_cap:50});}
const input=(over={})=>({connectivity:"offline",authority_decision:decision(),worker_id:"worker-1",capability:"jobs.update",operation_id:"op-1",action_id:"act-1",required_permissions:["jobs:write"],required_entitlements:["field"],current_context:current,minimum_score:40,mutating:true,protected_action:false,...over});

test("offline authority contracts score and never grants authority itself",()=>{const r=gate().evaluate(ctx(),input());assert.equal(r.allowed,true);assert.equal(r.source_score,80);assert.equal(r.effective_score,50);assert.equal(r.grants_authority,false);});
test("missing authority decision fails closed even with identity context",()=>{const r=gate().evaluate(ctx(),input({authority_decision:null}));assert.equal(r.allowed,false);assert.equal(r.reason,"fresh_authority_decision_required");});
test("stale policy context fails closed",()=>{const r=gate().evaluate(ctx(),input({authority_decision:decision({evaluated_at:"2026-09-12T23:50:00.000Z"})}));assert.equal(r.allowed,false);assert.equal(r.reason,"policy_context_stale");});
test("expired authority fails closed",()=>{const r=gate().evaluate(ctx(),input({authority_decision:decision({expires_at:"2026-09-13T00:01:00.000Z"})}));assert.equal(r.reason,"authority_expired");});
test("revision mismatch contracts to unavailable",()=>{for(const [field,value] of [["context_revision","ctx-2"],["account_revision","acct-2"],["policy_revision","pol-2"]]){const r=gate().evaluate(ctx(),input({current_context:{...current,[field]:value}}));assert.equal(r.allowed,false);assert.match(r.reason,/mismatch/);}});
test("required permission and entitlement are fail closed",()=>{assert.equal(gate().evaluate(ctx(),input({authority_decision:decision({permissions:[]})})).reason,"missing_permission");assert.equal(gate().evaluate(ctx(),input({authority_decision:decision({entitlements:[]})})).reason,"missing_entitlement");});
test("protected mutating action requires online fresh authority",()=>{const r=gate().evaluate(ctx(),input({protected_action:true}));assert.equal(r.allowed,false);assert.equal(r.reason,"protected_action_requires_online_fresh_authority");});
test("offline contraction cannot satisfy a higher minimum than its cap",()=>{const r=gate().evaluate(ctx(),input({minimum_score:60}));assert.equal(r.allowed,false);assert.equal(r.reason,"offline_authority_below_required");});
test("online authority does not expand beyond source score",()=>{const r=gate().evaluate(ctx(),input({connectivity:"online",minimum_score:70}));assert.equal(r.allowed,true);assert.equal(r.effective_score,80);});
test("cross-company and legacy aliases fail closed",()=>{assert.throws(()=>gate().evaluate(ctx(),input({authority_decision:decision({company_id:"company-b"})})),/cross-company/i);assert.throws(()=>gate().evaluate(ctx(),input({current_context:{...current,tenant_id:"legacy"}})),/legacy/i);});
test("descriptor makes contraction-only semantics explicit",()=>{const d=gate().descriptor;assert.equal(d.contraction_only,true);assert.equal(d.cached_identity_grants_authority,false);assert.equal(d.cached_role_grants_authority,false);assert.equal(d.stale_policy_grants_authority,false);});
