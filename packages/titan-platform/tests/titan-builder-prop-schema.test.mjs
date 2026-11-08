import test from "node:test"; import assert from "node:assert/strict";
import { builderPropControls,builderCatalogPolicy,coerceBuilderProp } from "../.test-dist/titan-builder/prop-schema.js";
test("catalog props become component-specific controls",()=>{const c=builderPropControls("approval-card");assert.deepEqual(c.map(x=>x.key),["title","summary","impact","tone","icon"]);assert.equal(c.find(x=>x.key==="tone").kind,"select")});
test("complex catalogue props are JSON controls",()=>assert.equal(builderPropControls("chat-assistant").find(x=>x.key==="messages").kind,"json"));
test("catalog policy exposes governed actions without granting authority",()=>{const p=builderCatalogPolicy("job-list");assert.equal(p.authority,"presentation-only");assert.ok(p.allowed_actions.includes("crm.work_order.assign"))});
test("prop coercion supports typed editing",()=>{assert.equal(coerceBuilderProp("number","12"),12);assert.deepEqual(coerceBuilderProp("json",'[{"a":1}]'),[{a:1}]);assert.equal(coerceBuilderProp("boolean",true),true)});
