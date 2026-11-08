import test from "node:test";
import assert from "node:assert/strict";
import { compileVerticalProfile, exposeVerticalCapabilities } from "../.test-dist/vertical-profile.js";
const input={profile_id:"home-services",version:1,display_name:"Home Services",capabilities:["dispatch","quotes"],terminology:{job:"service job"},source_ref:"catalog:v1",core_version:"3"};
test("compiles only known declarative capabilities",()=>{const p=compileVerticalProfile(input,["dispatch","quotes"],"2026-02-01T00:00:00Z"); assert.equal(p.schema,"titan.vertical-profile.v1"); assert.deepEqual(exposeVerticalCapabilities(p,["dispatch"]),["dispatch"]);});
test("rejects unknown capabilities",()=>assert.throws(()=>compileVerticalProfile({...input,capabilities:["private-authority"]},["dispatch"]),/unknown-capability/));
test("rejects invalid provenance/version",()=>{assert.throws(()=>compileVerticalProfile({...input,version:0},["dispatch","quotes"]),/profile-version-invalid/); assert.throws(()=>compileVerticalProfile({...input,source_ref:""},["dispatch","quotes"]),/source_ref-required/);});

