import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeBuilderWorkspace } from '../.test-dist/titan-builder/signal-priority.js';

const plan={purpose:'test',surface:'zero',max_visible_cards:3,chat_first:true,authority_granted:false,sections:[
 {role:'supporting',intent:'generic',node:{type:'card',props:{id:'a'}}},
 {role:'supporting',intent:'review',node:{type:'card',props:{id:'b'}}}
]};

test('Signal prioritization requires canonical company_id',()=>{
 assert.throws(()=>prioritizeBuilderWorkspace(plan,{company_id:'   ',signals:[]}),/company_id-required/);
});

test('Signal prioritization ignores cross-company signals and stays advisory',()=>{
 const result=prioritizeBuilderWorkspace(plan,{company_id:'company-1',now:'2026-09-22T00:00:00Z',signals:[
  {id:'foreign',company_id:'company-2',surface:'zero',intent:'review',severity:'critical',observed_at:'2026-09-22T00:00:00Z',impact:30},
  {id:'local',company_id:'company-1',surface:'zero',intent:'generic',severity:'warning',observed_at:'2026-09-22T00:00:00Z',impact:10}
 ]});
 assert.equal(result.sections[0].intent,'generic');
 const priority=result.sections[0].node.props.signal_priority;
 assert.equal(priority.id,'local');
 assert.equal(priority.advisory_only,true);
 assert.equal(priority.authority_granted,false);
 assert.equal(result.authority_granted,false);
});
