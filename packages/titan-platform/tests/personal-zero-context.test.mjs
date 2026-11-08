import test from "node:test";
import assert from "node:assert/strict";
import { assertPersonalZeroContextActive, createPersonalZeroContext, revokePersonalZeroContext } from "../.test-dist/personal-zero/context-relationship.js";
const input={context_id:"ctx-1",one_id:"person-1",zero_id:"zero-1",company_id:"company-a",role:"worker",capability_ids:["jobs.read"],data_scope:["assigned-work"]};
test("keeps One and Zero portable while binding company relationship",()=>{const context=createPersonalZeroContext(input);assert.equal(context.one_id,"person-1");assert.equal(assertPersonalZeroContextActive(context,"company-a"),context);});
test("revocation and context changes fail closed",()=>{const revoked=revokePersonalZeroContext(createPersonalZeroContext(input),"relationship-ended");assert.throws(()=>assertPersonalZeroContextActive(revoked,"company-a",revoked.revision),{message:"personal-zero-context-revoked"});assert.throws(()=>assertPersonalZeroContextActive(createPersonalZeroContext(input),"company-b"),{message:"personal-zero-company-mismatch"});});
