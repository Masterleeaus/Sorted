import test from "node:test";
import assert from "node:assert/strict";
import {createChatState,applyChatEvent,createChatResumeCheckpoint,createChatResumePlan,createChatSnapshot} from "../src/ported/titan-runtime/interaction-engine/chat-state.js";
const base={conversation_id:"c1",company_id:"co1",surface:"go"};
const ev=(id,seq,text="x")=>({schema:"titan.chat.event.v1",event_id:id,conversation_id:"c1",company_id:"co1",surface:"go",type:"assistant_message",text,sequence:seq,authority_granted:false});
function built(){
 let s=createChatState(base); const events=[];
 for(let i=1;i<=3;i++){const e=ev("e"+i,i); events.push(e); s=applyChatEvent(s,e)}
 return {s,events};
}
test("checkpoint is bounded authority-free cursor",()=>{const {s}=built();const c=createChatResumeCheckpoint(s);assert.equal(c.last_sequence,3);assert.equal(c.authority_granted,false)});
test("same cursor returns current",()=>{const {s}=built();assert.equal(createChatResumePlan(s,createChatResumeCheckpoint(s),[]).mode,"current")});
test("offline cursor replays contiguous retained events",()=>{const {s,events}=built();const old={schema:"titan.chat.resume.v1",conversation_id:"c1",company_id:"co1",surface:"go",revision:1,last_sequence:1,processed_event_ids:["e1"],authority_granted:false};const p=createChatResumePlan(s,old,events);assert.equal(p.mode,"replay");assert.deepEqual(p.events.map(x=>x.sequence),[2,3])});
test("retention gap requires snapshot",()=>{const {s,events}=built();const old={schema:"titan.chat.resume.v1",conversation_id:"c1",company_id:"co1",surface:"go",revision:1,last_sequence:1,processed_event_ids:["e1"],authority_granted:false};assert.equal(createChatResumePlan(s,old,[events[2]]).mode,"snapshot_required")});
test("snapshot preserves sequence and components",()=>{const {s}=built();const x=createChatSnapshot(s);assert.equal(x.last_sequence,3);assert.equal(x.authority_granted,false)});
test("cross company checkpoint rejected",()=>{const {s}=built();assert.throws(()=>createChatResumePlan(s,{schema:"titan.chat.resume.v1",conversation_id:"c1",company_id:"evil",surface:"go",revision:0,last_sequence:0,authority_granted:false},[]),/company-mismatch/)});
test("cross surface checkpoint rejected",()=>{const {s}=built();assert.throws(()=>createChatResumePlan(s,{schema:"titan.chat.resume.v1",conversation_id:"c1",company_id:"co1",surface:"hub",revision:0,last_sequence:0,authority_granted:false},[]),/surface-mismatch/)});
test("cross conversation checkpoint rejected",()=>{const {s}=built();assert.throws(()=>createChatResumePlan(s,{schema:"titan.chat.resume.v1",conversation_id:"other",company_id:"co1",surface:"go",revision:0,last_sequence:0,authority_granted:false},[]),/conversation-mismatch/)});
test("checkpoint ahead rejected",()=>{const {s}=built();assert.throws(()=>createChatResumePlan(s,{schema:"titan.chat.resume.v1",conversation_id:"c1",company_id:"co1",surface:"go",revision:99,last_sequence:99,authority_granted:false},[]),/checkpoint-ahead/)});
test("legacy tenant checkpoint rejected",()=>{const {s}=built();assert.throws(()=>createChatResumePlan(s,{schema:"titan.chat.resume.v1",conversation_id:"c1",company_id:"co1",tenant_id:"x",surface:"go",revision:0,last_sequence:0,authority_granted:false},[]),/not an authority boundary/)});
test("replayed duplicate remains no-op",()=>{const {s}=built();assert.equal(applyChatEvent(s,ev("e3",3)),s)});
test("replay event boundary is verified",()=>{const {s}=built();const old={schema:"titan.chat.resume.v1",conversation_id:"c1",company_id:"co1",surface:"go",revision:1,last_sequence:1,authority_granted:false};assert.throws(()=>createChatResumePlan(s,old,[{...ev("bad",2),company_id:"evil"}]),/company-mismatch/)});
