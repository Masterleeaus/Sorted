import test from "node:test";
import assert from "node:assert/strict";
import {createMemoryStorageAdapter,createCompanyRepository} from "../.test-dist/storage/index.js";
import {createOfflineMutationQueue} from "../.test-dist/offline/index.js";

const ctx=(company_id="company-a")=>({company_id,actor_id:"field",operation_id:"queue-test"});
function setup(opts={}){
  let now=1000;
  const repository=createCompanyRepository({adapter:createMemoryStorageAdapter(),clock:()=>now});
  const queue=createOfflineMutationQueue({repository,clock:()=>now,base_delay_ms:100,max_delay_ms:500,max_retries:2,...opts});
  return {queue,setNow:v=>{now=v}};
}
const item=(id="op1")=>({operation_id:id,idempotency_key:`idem-${id}`,mutation_kind:"update",target:`jobs/${id}`,payload:{status:"done"}});

test("enqueue is durable, company scoped and duplicate safe",async()=>{const {queue}=setup();assert.equal((await queue.enqueue(ctx(),item())).status,"queued");assert.equal((await queue.enqueue(ctx(),item())).status,"duplicate");assert.equal((await queue.list(ctx())).length,1);assert.equal((await queue.list(ctx("company-b"))).length,0);});
test("bounded backpressure fails closed",async()=>{const {queue}=setup({max_pending:1});await queue.enqueue(ctx(),item("a"));await assert.rejects(()=>queue.enqueue(ctx(),item("b")),/backpressure/);});
test("transient failures get bounded exponential retry",async()=>{const {queue}=setup();await queue.enqueue(ctx(),item());const r1=await queue.resolve(ctx(),"op1",{ok:false,failure_class:"offline"});assert.equal(r1.state,"retry_wait");assert.equal(r1.retry_count,1);assert.equal(r1.next_retry_at,1100);const r2=await queue.resolve(ctx(),"op1",{ok:false,failure_class:"network_unavailable"});assert.equal(r2.retry_count,2);assert.equal(r2.next_retry_at,1200);const r3=await queue.resolve(ctx(),"op1",{ok:false,failure_class:"offline"});assert.equal(r3.state,"dead_letter");});
test("ambiguous effect outcomes are poison-isolated immediately",async()=>{const {queue}=setup();await queue.enqueue(ctx(),item());const r=await queue.resolve(ctx(),"op1",{ok:false,failure_class:"timeout_after_dispatch"});assert.equal(r.state,"dead_letter");assert.equal((await queue.deadLetters(ctx())).length,1);});
test("one poison item does not block later queue items",async()=>{const {queue}=setup();await queue.enqueue(ctx(),item("a"));await queue.enqueue(ctx(),item("b"));await queue.resolve(ctx(),"a",{ok:false,failure_class:"validation_failed"});const due=await queue.due(ctx());assert.deepEqual(due.map(x=>x.operation_id),["b"]);});
test("successful resolution completes without replay authority",async()=>{const {queue}=setup();await queue.enqueue(ctx(),item());const r=await queue.resolve(ctx(),"op1",{ok:true});assert.equal(r.state,"completed");assert.equal(r.grants_authority,false);assert.equal(r.automatic_effect_replay,false);});
test("legacy/cross-company content fails closed",async()=>{const {queue}=setup();await assert.rejects(()=>queue.enqueue(ctx(),{...item(),payload:{tenant_id:"x"}}),/legacy/i);await assert.rejects(()=>queue.enqueue(ctx(),{...item(),payload:{company_id:"company-b"}}),/cross-company/i);});
test("descriptor is durable bounded and authority neutral",()=>{const {queue}=setup();assert.equal(queue.descriptor.durable,true);assert.equal(queue.descriptor.poison_isolation,true);assert.equal(queue.descriptor.identity_grants_authority,false);assert.equal(queue.descriptor.execution_authority,false);});
