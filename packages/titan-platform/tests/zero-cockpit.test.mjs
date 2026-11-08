import test from "node:test";
import assert from "node:assert/strict";
import { projectZeroCockpit, assertCockpitProjectionScope } from "../.test-dist/zero-cockpit.js";
const rows=[{attention_id:"b",company_id:"co-1",category:"task",title:"Task",priority:1,created_at:"2026-02-01T00:00:00Z",source_ref:"work:b"},{attention_id:"a",company_id:"co-1",category:"approval",title:"Approve",priority:5,created_at:"2026-02-01T01:00:00Z",source_ref:"approval:a"}];
test("projects deterministic company-scoped attention",()=>{const p=projectZeroCockpit({company_id:"co-1",generated_at:"2026-02-01T02:00:00Z",attention:rows});assert.deepEqual(p.attention.map(x=>x.attention_id),["a","b"]);assert.equal(p.approval_count,1);assert.equal(p.read_only,true);assert.equal(assertCockpitProjectionScope(p,"co-1"),true);});
test("rejects cross-company attention and access",()=>{assert.throws(()=>projectZeroCockpit({company_id:"co-1",generated_at:"2026-02-01T00:00:00Z",attention:[{...rows[0],company_id:"co-2"}]}),/attention-company-mismatch/);const p=projectZeroCockpit({company_id:"co-1",generated_at:"2026-02-01T00:00:00Z",attention:[]});assert.throws(()=>assertCockpitProjectionScope(p,"co-2"),/cockpit-company-mismatch/);});
test("rejects malformed source facts",()=>assert.throws(()=>projectZeroCockpit({company_id:"co-1",generated_at:"bad",attention:[]}),/generated_at-invalid/));

