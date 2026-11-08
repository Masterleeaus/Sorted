import test from "node:test";import assert from "node:assert/strict";import {createCampaign,transitionCampaign,recordImpression,recordConversion} from "../.test-dist/growth-attribution.js";
const input={campaign_id:"c1",company_id:"co1",name:"spring",consent_required:true,channel:"email",impression_refs:[],conversion_refs:[]};
test("requires consent and active campaign for attributable growth",()=>{let x=createCampaign(input);x=transitionCampaign(x,"APPROVED");x=transitionCampaign(x,"ACTIVE");x=recordImpression(x,"impression:1",true);x=recordConversion(x,"quote:1");assert.deepEqual(x.conversion_refs,["quote:1"]);assert.equal(x.authorityGranted,false)});
test("rejects unconsented impressions and inactive conversion attribution",()=>{let x=createCampaign(input);assert.throws(()=>recordImpression(x,"i",false),/consent/);assert.throws(()=>recordConversion(x,"q"),/attributable/)})

