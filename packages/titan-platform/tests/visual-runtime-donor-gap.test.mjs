import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultVisualCapabilitySupport, planVisualCapabilityDegradation, validateVisualMetadata,
  negotiateVisualRuntimeCompatibility, planVisualOfflineCache, evaluateVisualResourceFreshness,
  verifyVisualResourceIntegrity, getVisualRuntimeHealth,
} from "../.test-dist/runtime.js";
const env={surface:"go",webgl:true,canvas:true,devicePixelRatio:2,connectivity:"poor",company_id:"c1"};
test("default capability registry follows environment",()=>{const s=defaultVisualCapabilitySupport(env);assert.equal(s.webgl,true);assert.equal(s.canvas,true);assert.equal(s["high-dpi"],true);});
test("degradation is deterministic",()=>assert.deepEqual(planVisualCapabilityDegradation(["spatial-3d","canvas"],["canvas"]),{selected:"canvas",degraded:true,deterministic:true}));
test("metadata guard rejects executable and authority-shaped payloads",()=>{assert.throws(()=>validateVisualMetadata({script:"x"}));assert.throws(()=>validateVisualMetadata({label:"javascript:alert(1)"}));});
test("compatibility keeps canonical surfaces and no authority",()=>{const r=negotiateVisualRuntimeCompatibility({visual_metadata_contract:"1.0",surface:"zero"});assert.equal(r.compatible,true);assert.equal(r.business_authority,false);});
test("offline cache prioritizes critical within budget",()=>{const r=planVisualOfflineCache([{role:"b",bytes:8},{role:"a",bytes:5,offlineCritical:true}],env,10);assert.equal(r.resources[0].role,"a");assert.equal(r.business_meaning_unchanged,true);});
test("freshness is bounded",()=>assert.equal(evaluateVisualResourceFreshness({fetchedAt:100,maxAgeSeconds:10},111).fresh,false));
test("sha256 integrity uses WebCrypto when available",async()=>{const expected="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";const r=await verifyVisualResourceIntegrity({sha256:expected},"abc");assert.equal(r.verified,true);});
test("health exposes no authority and company_id boundary",()=>{const h=getVisualRuntimeHealth();assert.equal(h.business_authority,false);assert.equal(h.tenant_boundary,"company_id");});
