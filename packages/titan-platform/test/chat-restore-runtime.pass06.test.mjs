import test from "node:test"; import assert from "node:assert/strict";
import {createChatState,applyChatEvent,createChatSnapshot} from "../src/ported/titan-runtime/interaction-engine/chat-state.js";
import {composeRestoredChatInterfacePresentation} from "../src/ported/titan-runtime/interface-runtime/chat-presentation.js";
import {createRestoredChatVisualPlan} from "../src/ported/titan-runtime/visual-runtime/chat-visual.js";
const comp={schema:"titan.chat.component.v1",component_id:"job",kind:"job",props:{title:"Job"},actions:[],authority_granted:false};
const e={schema:"titan.chat.event.v1",event_id:"e1",conversation_id:"c1",company_id:"co1",surface:"go",type:"component",components:[comp],sequence:1,authority_granted:false};
function restored(){let s=createChatState({conversation_id:"c1",company_id:"co1",surface:"go"});s=applyChatEvent(s,e);const snap=createChatSnapshot(s);const ui=composeRestoredChatInterfacePresentation(snap);return {s,snap,ui,visual:createRestoredChatVisualPlan(ui,{width:390})}}
test("snapshot reconstructs interface components",()=>{const x=restored();assert.equal(x.ui.components[0].component_id,"job");assert.equal(x.ui.restored,true)});
test("restored visual is mobile responsive",()=>assert.equal(restored().visual.responsive.mode,"mobile"));
test("restored visual retains cursor",()=>{const x=restored();assert.equal(x.visual.last_sequence,1);assert.equal(x.visual.revision,x.s.revision)});
test("restored chain preserves company and surface",()=>{const x=restored();assert.equal(x.visual.company_id,"co1");assert.equal(x.visual.surface,"go")});
test("restored chain remains authority free",()=>{const x=restored();assert.equal(x.ui.authority_granted,false);assert.equal(x.visual.authority_granted,false)});
test("command bus remains execution owner",()=>assert.equal(restored().visual.execution_owner,"command-bus"));
test("bad snapshot authority rejected",()=>{const x=restored();assert.throws(()=>composeRestoredChatInterfacePresentation({...x.snap,authority_granted:true}),/authority/)});
test("cross tenant alias rejected",()=>{const x=restored();assert.throws(()=>composeRestoredChatInterfacePresentation({...x.snap,tenant_id:"bad"}),/not an authority boundary/)});
test("invalid snapshot schema rejected",()=>{const x=restored();assert.throws(()=>composeRestoredChatInterfacePresentation({...x.snap,schema:"bad"}),/schema/)});
test("restored visual rejects normal presentation schema",()=>{const x=restored();assert.throws(()=>createRestoredChatVisualPlan({...x.ui,schema:"titan.chat.interface-presentation.v1"}),/schema/)});
