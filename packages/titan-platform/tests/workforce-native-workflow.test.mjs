import test from "node:test";
import assert from "node:assert/strict";
import { buildTitanNativeWorkflowPlan, executeTitanNativeWorkflow } from "../.test-dist/workforce-native/index.js";

function ledger() {
  const rows = new Map();
  return { rows, get: (key) => rows.get(key) ?? null, put: (receipt) => { rows.set(receipt.idempotencyKey, receipt); } };
}

test("native workflow chains declared Reception -> Booking -> Scheduling -> Jobs edges", () => {
  const plan = buildTitanNativeWorkflowPlan({
    workflowId: "wf1", companyId: "c1", actorId: "u1", idempotencyKey: "idem1",
    steps: [
      { id: "capture", agentKey: "reception", input: { action: "capture_service_request", payload: { name: "A", phone: "0400000000", service_type: "cleaning" } } },
      { id: "book", agentKey: "booking", input: { action: "get_request", requestId: "br1" } },
      { id: "schedule", agentKey: "scheduling", input: { action: "list_jobs" } },
      { id: "job", agentKey: "jobs", input: { action: "get_project", projectId: "j1" } },
    ],
  });
  assert.equal(plan.company_id, "c1");
  assert.equal(plan.steps.length, 4);
  assert.equal(plan.steps[0].idempotencyKey, "idem1:capture");
  assert.equal(plan.authority.execution_permitted, false);
  assert.equal(plan.execution_model.delegation_runtime_owned_elsewhere, true);
});

test("native workflow rejects undeclared cross-agent jumps", () => {
  assert.throws(() => buildTitanNativeWorkflowPlan({ workflowId:"wf2", companyId:"c1", idempotencyKey:"idem2", steps:[
    { id:"a", agentKey:"reception", input:{ action:"search_customer", payload:{ query:"A" } } },
    { id:"b", agentKey:"jobs", input:{ action:"list_projects" } },
  ]}), /workflow-handoff-not-declared:reception->jobs/);
});

test("native workflow owns company boundary and rejects aliases in step input", () => {
  assert.throws(() => buildTitanNativeWorkflowPlan({ workflowId:"wf3", companyId:"c1", idempotencyKey:"idem3", steps:[
    { id:"a", agentKey:"jobs", input:{ action:"list_projects", tenant_id:"c2" } },
  ]}), /workflow-step-company-boundary-owned:tenant_id/);
});

test("native workflow skips already successful idempotent steps", async () => {
  const plan = buildTitanNativeWorkflowPlan({ workflowId:"wf4", companyId:"c1", idempotencyKey:"idem4", steps:[
    { id:"a", agentKey:"jobs", input:{ action:"list_projects" } },
  ]});
  const l = ledger();
  l.rows.set("idem4:a", { idempotencyKey:"idem4:a", status:"SUCCEEDED", result:{ ok:true } });
  let executions = 0;
  const result = await executeTitanNativeWorkflow({ plan, ledger:l, executor:{ authorize:()=>true, execute:()=>{ executions++; return {}; } } });
  assert.equal(executions, 0);
  assert.equal(result.receipts[0].status, "SKIPPED_DUPLICATE");
  assert.equal(result.status, "SUCCEEDED");
});

test("native workflow stops on partial failure and compensates only explicit prior steps", async () => {
  const plan = buildTitanNativeWorkflowPlan({ workflowId:"wf5", companyId:"c1", actorId:"u1", idempotencyKey:"idem5", steps:[
    { id:"capture", agentKey:"reception", input:{ action:"capture_service_request", payload:{ name:"A", phone:"0400000000", service_type:"cleaning" } }, compensation:{ agentKey:"reception", input:{ action:"list_service_requests" } } },
    { id:"book", agentKey:"booking", input:{ action:"get_request", requestId:"br1" } },
  ]});
  const l = ledger();
  const calls = [];
  const result = await executeTitanNativeWorkflow({ plan, ledger:l, compensateOnFailure:true, executor:{
    authorize:()=>true,
    execute:({ step_id, compensation })=>{ calls.push([step_id, compensation]); if (step_id === "book" && !compensation) throw new Error("downstream-failed"); return { ok:true }; }
  }});
  assert.equal(result.failed_step_id, "book");
  assert.equal(result.status, "COMPENSATED");
  assert.deepEqual(calls, [["capture",false],["book",false],["capture",true]]);
  assert.ok(result.receipts.some((receipt)=>receipt.status === "COMPENSATED"));
});

test("native workflow fails closed when authority denies a step", async () => {
  const plan = buildTitanNativeWorkflowPlan({ workflowId:"wf6", companyId:"c1", idempotencyKey:"idem6", steps:[
    { id:"resolve", agentKey:"customer_care", input:{ action:"get_customer", customerId:"cu1" } },
  ]});
  const result = await executeTitanNativeWorkflow({ plan, ledger:ledger(), executor:{ authorize:()=>false, execute:()=>{ throw new Error("should-not-execute"); } } });
  assert.equal(result.status, "FAILED_AUTHORIZATION");
  assert.equal(result.receipts[0].error, "authorization-denied");
});
