import assert from "node:assert/strict";
import {builderFieldTargets,suggestBuilderFieldMap,validateBuilderFieldMap} from "../.test-dist/titan-builder/field-mapping.js";
assert(builderFieldTargets("job-list").includes("customer"));
const map=suggestBuilderFieldMap("job-list",["id","reference","status","scheduled_at","site_summary","customer_summary"]);
assert.equal(map.title,"reference"); assert.equal(map.time,"scheduled_at"); assert.equal(map.customer,"customer_summary");
assert.equal(validateBuilderFieldMap("go","crm-field-assigned-work",map).authority_granted,false);
assert.throws(()=>validateBuilderFieldMap("go","crm-field-assigned-work",{title:"secret_field"}),/not declared/);
console.log("titan-builder-field-mapping: 4/4 PASS");
