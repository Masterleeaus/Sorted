import test from "node:test";
import assert from "node:assert/strict";
import { createBusinessEngineMapping, assertBusinessEngineMappingScope } from "../.test-dist/business-engine-mapping.js";
const base={mapping_id:"m1",company_id:"co-1",provider:"frappe",site_ref:"site:co-1",capability_id:"crm.customer",titan_contract_version:"v1",classification:"MAP",source_ref:"doc:customer",identity_ref:"customer:1",sync_direction:"inbound",created_at:"2026-02-01T00:00:00Z"};
test("creates company/provider-bound mapping",()=>{const m=createBusinessEngineMapping(base);assert.equal(m.authority_owner,"titan");assert.equal(assertBusinessEngineMappingScope(m,{company_id:"co-1",capability_id:"crm.customer"}),true);});
test("requires provider site and forbids retired sync",()=>{assert.throws(()=>createBusinessEngineMapping({...base,site_ref:null}),/site-ref-required/);assert.throws(()=>createBusinessEngineMapping({...base,classification:"RETIRE"}),/retired-mapping-sync-forbidden/);});
test("rejects cross-company/capability use",()=>{const m=createBusinessEngineMapping(base);assert.throws(()=>assertBusinessEngineMappingScope(m,{company_id:"co-2",capability_id:"crm.customer"}),/company-mismatch/);assert.throws(()=>assertBusinessEngineMappingScope(m,{company_id:"co-1",capability_id:"finance.invoice"}),/capability-mismatch/);});
