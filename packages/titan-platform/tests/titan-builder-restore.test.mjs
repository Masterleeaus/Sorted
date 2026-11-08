import test from "node:test";
import assert from "node:assert/strict";
import { TitanBuilderWorkspace } from "../.test-dist/titan-builder/editor.js";

test("restores an exact company-scoped draft without changing its revision", () => {
  const original = new TitanBuilderWorkspace({company_id:"company-1",surface:"zero",id:"w1",root:{id:"root",type:"stack",children:[{id:"card-1",type:"card",props:{title:"A"}}]}});
  original.patch("card-1",{title:"B"});
  const snapshot = original.snapshot();
  const restored = TitanBuilderWorkspace.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
});

test("restore rejects an invalid company boundary", () => {
  assert.throws(() => TitanBuilderWorkspace.restore({id:"w",company_id:"",surface:"zero",title:"x",root:{id:"root",type:"stack",children:[]},revision:2,status:"draft",updated_at:new Date().toISOString()}), /company_id_required/);
});
