import test from "node:test";import assert from "node:assert/strict";import {createCareCase,transitionCare,resolveCare} from "../.test-dist/customer-care-recovery.js";
const input={case_id:"c1",company_id:"co1",customer_ref:"customer:1",reason:"missed visit",consent_required:true,evidence_refs:[]};
test("closes customer care only with resolution evidence",()=>{let x=createCareCase(input);x=transitionCare(x,"CONTACT_PENDING");x=transitionCare(x,"RESOLVED","resolution:e1");x=resolveCare(x,"fix:1","close:e1");assert.equal(x.stage,"CLOSED");assert.equal(x.authorityGranted,false)});
test("rejects invalid recovery transitions",()=>{assert.throws(()=>resolveCare(createCareCase(input),"r","e"),/stage/);let x=transitionCare(createCareCase(input),"CONTACT_PENDING");assert.throws(()=>transitionCare(x,"RESOLVED"),/evidence/)})

