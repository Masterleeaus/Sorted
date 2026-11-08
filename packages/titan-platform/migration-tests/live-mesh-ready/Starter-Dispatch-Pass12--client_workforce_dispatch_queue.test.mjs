import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDispatchQueueProjection,selectNextDispatchable,summarizeDispatchQueue} from '../titan-workforce/dispatch/dispatch-queue-runtime.mjs';

const work=[
 {company_id:'co-a',work_item_id:'job-done',state:'completed',priority:1,dependencies:[],trace_id:'t0',correlation_id:'c0'},
 {company_id:'co-a',work_item_id:'job-urgent',state:'ready',priority:10,dependencies:['job-done'],service_window_end_ms:1200,trace_id:'t1',correlation_id:'c1'},
 {company_id:'co-a',work_item_id:'job-normal',state:'ready',priority:5,dependencies:[],service_window_end_ms:1100,trace_id:'t2',correlation_id:'c2'},
 {company_id:'co-a',work_item_id:'job-blocked',state:'ready',priority:99,dependencies:['missing-job'],trace_id:'t3',correlation_id:'c3'},
 {company_id:'co-a',work_item_id:'job-later',state:'ready',priority:20,dependencies:[],service_window_start_ms:5000,trace_id:'t4',correlation_id:'c4'}
];

test('dispatch queue projects existing work items deterministically without dispatching',()=>{
 const q=buildDispatchQueueProjection({company_id:'co-a',now_ms:1000,queue_revision:2,work_items:work,assignments:[]});
 assert.equal(q.schema,'titan.workforce.dispatch.queue.v1');
 assert.deepEqual(q.items.map(x=>x.work_item_id),['job-urgent','job-normal','job-later','job-blocked','job-done']);
 assert.equal(q.items.find(x=>x.work_item_id==='job-blocked').queue_state,'BLOCKED_DEPENDENCY');
 assert.equal(q.items.find(x=>x.work_item_id==='job-later').queue_state,'UPCOMING');
 assert.equal(q.automatic_dispatch,false);assert.equal(q.execution_permitted,false);assert.equal(q.grants_authority,false);
});

test('existing assigned work is projected, not recreated or reassigned',()=>{
 const q=buildDispatchQueueProjection({company_id:'co-a',now_ms:1000,work_items:work,assignments:[{company_id:'co-a',assignment_id:'a1',work_item_id:'job-normal',worker_id:'w1',decision_state:'assigned'}]});
 const n=q.items.find(x=>x.work_item_id==='job-normal');
 assert.equal(n.queue_state,'ASSIGNED');assert.equal(n.assignment_id,'a1');assert.equal(n.assigned_worker_id,'w1');assert.equal(n.requires_governed_assignment,false);assert.equal(q.automatic_reassignment,false);
});

test('next dispatchable selection is recommendation-only and authority neutral',()=>{
 const q=buildDispatchQueueProjection({company_id:'co-a',now_ms:1000,work_items:work,assignments:[]});
 const n=selectNextDispatchable(q);assert.equal(n.work_item_id,'job-urgent');assert.equal(n.requires_governed_assignment,true);assert.equal(n.automatic_dispatch,false);assert.equal(n.execution_permitted,false);assert.equal(n.grants_authority,false);
 const s=summarizeDispatchQueue(q);assert.equal(s.ready,2);assert.equal(s.blocked_dependency,1);assert.equal(s.grants_authority,false);
});

test('queue rejects cross-company work items and assignments',()=>{
 assert.throws(()=>buildDispatchQueueProjection({company_id:'co-a',work_items:[...work,{company_id:'co-b',work_item_id:'evil',state:'ready'}]}),/cross-company-work-item/);
 assert.throws(()=>buildDispatchQueueProjection({company_id:'co-a',work_items:work,assignments:[{company_id:'co-b',assignment_id:'evil',work_item_id:'job-normal',worker_id:'x',decision_state:'assigned'}]}),/cross-company-assignment/);
});

test('queue rejects duplicate work item identity to preserve idempotent projection semantics',()=>{
 assert.throws(()=>buildDispatchQueueProjection({company_id:'co-a',work_items:[work[0],{...work[0]}]}),/duplicate-work-item/);
});
