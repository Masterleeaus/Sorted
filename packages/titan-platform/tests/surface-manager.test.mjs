import test from "node:test";
import assert from "node:assert/strict";
import { projectSurfaceEstate, createSurfaceIntent } from "../.test-dist/surface-manager.js";
const descriptor=(overrides={})=>({surface_id:"portal-1",company_id:"co-1",surface_class:"PORTAL",product_mode:"hub",audience:"customer",renderer:"web",runtime:"interface-runtime",version:"1.0.0",route:"/portal",capabilities:["view-job"],lifecycle:"LIVE",state:"LIVE",health:{uiReachable:true,backendReachable:true,capabilityDegraded:false,staleProjection:false,verificationFailed:false},provenance_ref:"build:1",authorityGranted:false,...overrides});
test("projects deployed surface facts without changing product-mode identity",()=>{const estate=projectSurfaceEstate({company_id:"co-1",descriptors:[descriptor()],deployed:{"portal-1":{version:"1.0.0",state:"LIVE",uiReachable:true,backendReachable:true}}});assert.equal(estate[0].surface_class,"PORTAL");assert.equal(estate[0].product_mode,"hub");assert.equal(estate[0].state,"LIVE");assert.equal(estate[0].authorityGranted,false);});
test("marks missing, stale and unreachable deployment facts truthfully",()=>{const stale=projectSurfaceEstate({company_id:"co-1",descriptors:[descriptor(),descriptor({surface_id:"missing",version:"2.0.0"}),descriptor({surface_id:"down"})],deployed:{"portal-1":{version:"0.9.0",state:"LIVE",uiReachable:true,backendReachable:true},down:{version:"1.0.0",state:"LIVE",uiReachable:false,backendReachable:true}}});const byId=Object.fromEntries(stale.map(item=>[item.surface_id,item]));assert.equal(byId["portal-1"].state,"DEGRADED");assert.equal(byId.missing.state,"DECLARED");assert.equal(byId.down.state,"UNREACHABLE");});
test("expires temporary surfaces, rejects cross-company access and emits deployment intent",()=>{
  const temporary=descriptor({surface_id:"mission",surface_class:"TEMPORARY_MISSION",temporary:{expires_at:"2026-09-30T00:00:00Z",end_condition:"mission-closed"}});
  const estate=projectSurfaceEstate({company_id:"co-1",now:"2026-10-01T00:00:00Z",descriptors:[temporary]});
  assert.equal(estate[0].state,"RETIRED");
  assert.throws(()=>projectSurfaceEstate({company_id:"co-1",descriptors:[descriptor({company_id:"co-2"})]}),/cross-company/);
  assert.deepEqual(createSurfaceIntent("co-1","portal-1","upgrade"),{surface_id:"portal-1",company_id:"co-1",intent:"upgrade",authorityGranted:false,delegated_to:"deployment-owner"});
});
