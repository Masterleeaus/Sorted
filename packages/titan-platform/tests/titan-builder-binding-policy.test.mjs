import assert from "node:assert/strict";
import test from "node:test";
import { builderDataSourceOptions, builderActionOptions, validateBuilderBinding } from "../dist-test/titan-builder/binding-policy.js";
test("data sources are surface filtered and read-only metadata is preserved",()=>{const zero=builderDataSourceOptions("zero");assert.ok(zero.length>0);assert.ok(zero.every(x=>typeof x.contract==="string"));assert.ok(zero.some(x=>x.read_only));});
test("actions remain declarative and never grant authority",()=>{const actions=builderActionOptions("zero");assert.ok(actions.length>0);const v=validateBuilderBinding("zero",actions[0].id);assert.equal(v.authority_granted,false);assert.equal(v.requires_downstream_authorization,true);});
test("cross-surface or unknown bindings fail closed",()=>{assert.throws(()=>validateBuilderBinding("zero","definitely-not-an-action"),/not compatible/);});
