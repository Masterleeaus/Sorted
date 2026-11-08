import test from "node:test";
import assert from "node:assert/strict";
import { builderProjectionOwner, createCapabilityOwnedBuilderProjectionProvider } from "../dist-test/titan-builder/projection-providers.js";

const context={company_id:"co-1",product_surface:"go",user_id:"u1",roles:["field"],capabilities:["crm.field.offline"]};
const request={schema:"titan.builder.projection-request/v1",company_id:"co-1",surface:"go",source:"crm-field-assigned-work",contract:"crm.field.assigned-work",fields:["id","reference","status"],required_capability:"crm.field.offline",read_only:true,purpose:"builder-preview",authority_granted:false};

test("routes operational projections to WorkCore and finance to Titan Money",()=>{
 assert.equal(builderProjectionOwner("crm.field.assigned-work"),"workcore");
 assert.equal(builderProjectionOwner("crm.customer.work-orders"),"workcore");
 assert.equal(builderProjectionOwner("crm.customer.invoices"),"titan-money");
 assert.equal(builderProjectionOwner("crm.customer.quotes"),"titan-money");
 assert.equal(builderProjectionOwner("crm.owner.finance-summary"),"titan-money");
 assert.equal(builderProjectionOwner("unknown.contract"),null);
});

test("forwards exact company/surface/source/contract/fields/capability to canonical owner",async()=>{
 let seen;
 const provider=createCapabilityOwnedBuilderProjectionProvider({workcore:(q)=>{seen=q;return {company_id:q.company_id,records:[{id:"j1",reference:"JOB-1",status:"scheduled",secret:"never-forwarded-by-adapter"}]};}});
 const out=await provider(request,context);
 assert.deepEqual(seen.fields,["id","reference","status"]);
 assert.equal(seen.company_id,"co-1"); assert.equal(seen.capability,"crm.field.offline"); assert.equal(seen.read_only,true);
 assert.equal(out.source,"crm-field-assigned-work");
});

test("missing owner executor returns null so Builder can use synthetic fallback",async()=>{
 const provider=createCapabilityOwnedBuilderProjectionProvider({});
 assert.equal(await provider(request,context),null);
});

test("fails closed on company drift and executor company mismatch",async()=>{
 const provider=createCapabilityOwnedBuilderProjectionProvider({workcore:()=>({company_id:"co-2",records:[]})});
 await assert.rejects(()=>provider({...request,company_id:"co-2"},context),/company_mismatch/);
 await assert.rejects(()=>provider(request,context),/executor_company_mismatch/);
});

test("requires declared capability and rejects unknown ownership",async()=>{
 const provider=createCapabilityOwnedBuilderProjectionProvider({workcore:()=>null});
 await assert.rejects(()=>provider({...request,required_capability:undefined},context),/capability_required/);
 await assert.rejects(()=>provider({...request,contract:"x.unknown"},context),/owner_unknown/);
});
