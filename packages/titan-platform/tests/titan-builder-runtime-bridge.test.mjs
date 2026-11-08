import test from 'node:test';
import assert from 'node:assert/strict';
import { createTitanInterfaceRuntime } from '../.tmp-builder-bridge/interface-runtime.js';
import { TitanBuilderWorkspace, createBuilderProposalFromPresentationIntent, previewBuilderThroughRuntimes, createBuilderPublishedHandoff } from '../.tmp-builder-bridge/titan-builder/index.js';

const runtime=createTitanInterfaceRuntime();
const context=runtime.createContext({company_id:'co-1',user_id:'user-1',product_surface:'zero',domain:'business'});

test('Interaction presentation intent becomes review-only Builder proposal',()=>{
 const proposal=createBuilderProposalFromPresentationIntent({company_id:'co-1',context,intent:{purpose:'Owner briefing',surface:'command',components:[{key:'health',type:'card',props:{title:'Business health'}}]}});
 assert.equal(proposal.surface,'zero'); assert.equal(proposal.requires_review,true); assert.equal(proposal.authority_granted,false); assert.equal(proposal.workspace.root.children[0].type,'card');
});

test('runtime preview crosses Interface and Visual runtimes without publish or authority',()=>{
 const workspace=new TitanBuilderWorkspace({company_id:'co-1',surface:'zero',root:{id:'root',type:'stack',props:{purpose:'Health',visual_hints:{motionPreset:'standard'}},children:[{id:'c1',type:'card',props:{title:'Healthy'}}]}});
 const preview=previewBuilderThroughRuntimes({document:workspace.snapshot(),context,environment:{surface:'zero',company_id:'co-1',width:1200,canvas:true,webgl:true}});
 assert.equal(preview.presentation.company_id,'co-1'); assert.equal(preview.visual.authorizes_actions,false); assert.equal(preview.publish,false); assert.equal(preview.authority_granted,false);
});

test('cross-company preview fails closed',()=>{
 const workspace=new TitanBuilderWorkspace({company_id:'co-1',surface:'zero'});
 assert.throws(()=>previewBuilderThroughRuntimes({document:workspace.snapshot(),context,environment:{surface:'zero',company_id:'co-2'}}),/company_mismatch/);
});

test('published handoff requires explicit Builder publish and downstream reauthorization',()=>{
 const workspace=new TitanBuilderWorkspace({company_id:'co-1',surface:'zero',root:{id:'root',type:'stack',children:[{id:'c1',type:'card'}]}});
 assert.throws(()=>createBuilderPublishedHandoff(workspace.snapshot(),context),/not_published/);
 workspace.publish(); const handoff=createBuilderPublishedHandoff(workspace.snapshot(),context);
 assert.equal(handoff.requires_downstream_action_authorization,true); assert.equal(handoff.builder_grants_authority,false); assert.equal(handoff.revision,1);
});
