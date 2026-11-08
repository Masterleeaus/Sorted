import test from "node:test";
import assert from "node:assert/strict";
import { decideInferenceRoute } from "../.test-dist/index.js";

test("cost sovereignty keeps inference local when local-only policy is set",()=>{
  const d=decideInferenceRoute({company_id:"c1",allowed_routes:["device","byo-cloud"],privacy_local_only:true});
  assert.equal(d.route,"device");
  assert.equal(d.escalation_reason,"local-only-policy");
  assert.equal(d.titan_funded_fallback,false);
  assert.equal(d.execution_authority,false);
});

test("Titan-managed inference requires entitlement or explicit metered opt-in",()=>{
  assert.equal(decideInferenceRoute({company_id:"c1",allowed_routes:["titan-managed"],titan_managed_entitled:true}).escalation_required,false);
  assert.equal(decideInferenceRoute({company_id:"c1",allowed_routes:["titan-managed"],titan_metered_opt_in:true}).escalation_required,false);
  assert.equal(decideInferenceRoute({company_id:"c1",allowed_routes:["titan-managed"],titan_metered_opt_in:false}).escalation_required,true);
  const d=decideInferenceRoute({company_id:"c1",allowed_routes:["titan-managed"]});
  assert.equal(d.escalation_reason,"titan-service-not-entitled");
  assert.equal(d.titan_funded_fallback,false);
});

test("cost sovereignty does not create an implicit Titan-funded fallback",()=>{
  const d=decideInferenceRoute({company_id:"c1",allowed_routes:["titan-managed"],titan_managed_entitled:false,titan_metered_opt_in:false});
  assert.equal(d.escalation_required,true);
  assert.equal(d.titan_funded_fallback,false);
});

test("cost sovereignty requires company_id and never grants authority",()=>{
  assert.throws(()=>decideInferenceRoute({company_id:""}),/company_id-required/);
  const d=decideInferenceRoute({company_id:"c1",allowed_routes:["device"]});
  assert.equal(d.authority_neutral,true);
  assert.equal(d.execution_authority,false);
});
