import test from "node:test";
import assert from "node:assert/strict";
import { TitanBuilderWorkspace } from "../.test-dist/titan-builder/index.js";

test("duplicate creates collision-safe subtree ids",()=>{const w=new TitanBuilderWorkspace({company_id:"c1",surface:"zero"});w.insert("root",{id:"a",type:"card",children:[{id:"b",type:"metric"}]});const d=w.duplicate("a");assert.equal(d.root.children.length,2);assert.notEqual(d.root.children[0].id,d.root.children[1].id);assert.notEqual(d.root.children[0].children[0].id,d.root.children[1].children[0].id);});
test("reorder changes sibling order and undo restores it",()=>{const w=new TitanBuilderWorkspace({company_id:"c1",surface:"zero"});w.insert("root",{id:"a",type:"card"});w.insert("root",{id:"b",type:"card"});assert.deepEqual(w.reorder("root",0,1).root.children.map(x=>x.id),["b","a"]);assert.deepEqual(w.undo().root.children.map(x=>x.id),["a","b"]);});
test("visibility is projection-sanitized",()=>{const w=new TitanBuilderWorkspace({company_id:"c1",surface:"zero"});w.insert("root",{id:"a",type:"card"});const d=w.setVisibility("a",{mode:"owner",password:"bad"});assert.equal(d.root.children[0].visibility.mode,"owner");assert.equal("password" in d.root.children[0].visibility,false);});
