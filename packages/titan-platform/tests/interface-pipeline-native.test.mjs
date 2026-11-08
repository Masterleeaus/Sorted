import test from"node:test";import assert from"node:assert/strict";import{InterfaceRuntimePipeline}from"../.test-dist/interface-catalog.js";
const descriptor={schema_version:"1.1",extension_key:"cleaning",context:{},domains:[{key:"operations",label:"Operations",product_surfaces:["command"]}],objects:[{key:"job",label:"Job",scope:{type:"tenant",tenant_key:"company_id"},product_surfaces:["command"],customer_safe:false}],facets:[{key:"summary",applies_to:["job"],product_surfaces:["command"],customer_safe:false}],views:[{key:"today",applies_to:["job"],product_surfaces:["command"],customer_safe:false}],actions:[{key:"prepare",applies_to:["job"],product_surfaces:["command"],customer_safe:false,mutating:false}],relationships:[],lifecycles:[],global_work:[],providers:{attention:[],decisions:[],insights:[]},legacy_data_surfaces:[]};
const source={source:"Cleaning",extension_key:"cleaning",enabled:true,contract_version:"1.1",manifest_path:"interface.json",descriptor};
test("pipeline discovers, catalogs and composes authority-neutral zero presentation",()=>{const x=new InterfaceRuntimePipeline().run("co-1","command",[source]);assert.equal(x.discovery.health.Cleaning.state,"VALID");assert.equal(x.catalog.surface,"zero");assert.equal(x.presentation.company_id,"co-1");assert.equal(x.presentation.authority,"presentation-only");assert.equal(x.presentation.nodes.length,5);assert.ok(x.presentation.nodes.every(n=>n.owner==="cleaning"))});
test("pipeline requires company_id before presentation",()=>{assert.throws(()=>new InterfaceRuntimePipeline().run("","zero",[source]),/company_id/)});
test("hub projection excludes explicitly non-customer-safe semantic items",()=>{const hub=structuredClone(descriptor);hub.extension_key="hub-cleaning";hub.domains[0].customer_safe=true;for(const s of["domains","objects","facets","views","actions"])for(const x of hub[s])x.product_surfaces=["hub"];const x=new InterfaceRuntimePipeline().run("co-1","hub",[{...source,source:"Hub",extension_key:"hub-cleaning",descriptor:hub}]);assert.equal(x.presentation.nodes.length,1);assert.equal(x.presentation.nodes[0].semantic_kind,"domain")});
test("cross-extension semantic collisions fail closed from presentation",()=>{const b=structuredClone(descriptor);b.extension_key="cleaning-two";const x=new InterfaceRuntimePipeline().run("co-1","zero",[source,{...source,source:"Cleaning2",extension_key:"cleaning-two",descriptor:b}]);assert.equal(x.presentation.nodes.length,0);assert.ok(Object.keys(x.catalog.collisions).length>=5)});

test('hub projection requires explicit customer safety even for domains', () => {
  for (const customer_safe of [undefined, false, 'true']) {
    const hub = structuredClone(descriptor);
    for (const section of ['domains', 'objects', 'facets', 'views', 'actions']) {
      for (const item of hub[section]) { item.product_surfaces = ['hub']; item.customer_safe = customer_safe; }
    }
    const result = new InterfaceRuntimePipeline().run('co-1', 'hub', [{ ...source, descriptor: hub }]);
    assert.equal(result.presentation.nodes.length, 0);
  }
});
