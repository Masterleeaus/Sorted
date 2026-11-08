import assert from 'node:assert/strict';
import { chatEventFromPresentationIntent } from '../src/ported/titan-runtime/interaction-engine/chat-protocol.js';
import { composeChatInterfacePresentation } from '../src/ported/titan-runtime/interface-runtime/chat-presentation.js';
import { createChatVisualPlan } from '../src/ported/titan-runtime/visual-runtime/chat-visual.js';

let n=0; const test=(name,fn)=>{fn();n++;console.log('PASS',name)};
const intent={authority_neutral:true,company_id:'co-1',surface:'command',payload:{semantic_components:[
 {id:'a',kind:'approval',props:{title:'Approve quote'}},{id:'b',kind:'metric',props:{title:'Revenue'}},{id:'c',kind:'job',props:{title:'Next job'}},{id:'d',kind:'alert',props:{title:'hidden fourth'}}]},actions:[{intent:'quote.approve',params:{id:'q1'}}]};
const event=chatEventFromPresentationIntent(intent,{event_id:'e1',conversation_id:'c1'});
const ui=composeChatInterfacePresentation(event);
const visual=createChatVisualPlan(ui,{width:390,density:'compact'});
test('canonical surface aliases normalize before rendering',()=>assert.equal(visual.surface,'zero'));
test('company_id survives end-to-end',()=>assert.equal(visual.company_id,'co-1'));
test('three-card chat-first cap survives both runtimes',()=>assert.equal(visual.components.length,3));
test('Interface Runtime is composition owner',()=>assert.equal(ui.runtime_id,'interface-runtime'));
test('Visual Runtime is visual owner',()=>assert.equal(visual.runtime_id,'visual-runtime'));
test('semantic ownership remains Interaction Engine',()=>assert.equal(visual.semantic_owner,'interaction-engine'));
test('actions remain declarative and downstream-authorized',()=>assert.ok(visual.components.every(c=>c.actions.every(a=>a.authority_granted===false&&a.downstream_authorization_required===true))));
test('visual plan grants no authority',()=>assert.equal(visual.authority_granted,false));
test('mobile responsive contract generated',()=>assert.equal(visual.responsive.mode,'mobile'));
test('desktop responsive contract generated',()=>assert.equal(createChatVisualPlan(ui,{width:1280}).responsive.mode,'desktop'));
test('legacy tenant authority fails closed',()=>assert.throws(()=>composeChatInterfacePresentation({...event,tenant_id:'bad'})));
test('forged event authority fails closed',()=>assert.throws(()=>composeChatInterfacePresentation({...event,authority_granted:true})));
test('forged action authority fails closed',()=>assert.throws(()=>composeChatInterfacePresentation({...event,components:[{...event.components[0],actions:[{intent:'x',authority_granted:true,downstream_authorization_required:false}]}]})));
console.log(`RESULT ${n}/13 PASS`);
