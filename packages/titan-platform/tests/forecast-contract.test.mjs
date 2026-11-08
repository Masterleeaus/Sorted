import test from "node:test";import assert from "node:assert/strict";import {createForecast,createCalibration} from "../.test-dist/forecast-contract.js";
const input={forecast_id:"f1",company_id:"co1",subject:"jobs",metric:"completed",issued_at:"2026-09-29T00:00:00Z",target_from:"2026-10-01",target_to:"2026-10-31",model_ref:"model:v1",assumptions:["capacity stable"],confidence:.8,uncertainty:"medium",evidence_refs:["e:1"],provenance_ref:"forecast:1"};
test("keeps forecast immutable and calibrates only against linked outcome",()=>{const f=createForecast(input);const c=createCalibration(f,"co1",.9,"outcome:1","2026-11-01T00:00:00Z");assert.ok(Math.abs(c.error-.1)<1e-9);assert.equal(f.authorityGranted,false);assert.equal(c.authorityGranted,false)});
test("rejects weak or cross-company forecast calibration",()=>{assert.throws(()=>createForecast({...input,evidence_refs:[]}),/evidence/);assert.throws(()=>createCalibration(createForecast(input),"co2",1,"o","2026-11-01"),/company/)})

