import assert from "node:assert/strict";
import test from "node:test";
import { assembleWorkforceContext } from "../../.tmp-wf-context-build/assembler.js";
import { projectWorkforceContextForTask } from "../../.tmp-wf-context-build/projection.js";
import {
  advanceWorkforceTaskCheckpoint,
  createWorkforceTaskCheckpoint,
  restoreWorkforceTaskCheckpoint,
} from "../../.tmp-wf-context-build/checkpoint.js";

function projection() {
  const context = assembleWorkforceContext({
    company_id: "company-1",
    objective_id: "objective-1",
    task_id: "task-1",
    correlation_id: "corr-1",
    actor: { id: "manager-1", company_id: "company-1", role: "manager" },
    authority: { source: "business-ops-authority", revision: 4 },
    customer: { id: "cust-1", company_id: "company-1", version: 2 },
    job: { id: "job-1", company_id: "company-1", version: 8 },
  });
  return projectWorkforceContextForTask(context, {
    company_id: "company-1",
    task_id: "task-1",
    worker_id: "worker-1",
    purpose: "complete assigned job",
    allowed_sources: ["customer", "job"],
    field_grants: [
      { source_kind: "customer", fields: ["display_name"] },
      { source_kind: "job", fields: ["status"] },
    ],
  });
}

test("creates payload-free task-local checkpoint from projection", () => {
  const checkpoint = createWorkforceTaskCheckpoint({
    projection: projection(),
    step: "arrive",
    pending_operation_ids: ["op-1"],
    updated_at: "2026-09-13T08:45:00+10:00",
  });
  assert.equal(checkpoint.company_id, "company-1");
  assert.equal(checkpoint.task_id, "task-1");
  assert.equal(checkpoint.checkpoint_revision, 1);
  assert.equal(checkpoint.policies.checkpoint_contains_no_business_payload, true);
  assert.deepEqual(checkpoint.source_versions.find((x) => x.kind === "job"), { kind: "job", id: "job-1", version: 8 });
  assert.equal("customer_payload" in checkpoint, false);
});

test("rejects attempts to persist business payloads or legacy tenant aliases", () => {
  assert.throws(() => createWorkforceTaskCheckpoint({ projection: projection(), business_payload: { secret: true } }), /business_payload is not allowed/);
  assert.throws(() => createWorkforceTaskCheckpoint({ projection: projection(), tenant_id: "legacy" }), /tenant_id is not allowed/);
});

test("restores only for the same company task and worker", () => {
  const checkpoint = createWorkforceTaskCheckpoint({ projection: projection() });
  assert.equal(restoreWorkforceTaskCheckpoint(checkpoint, {
    company_id: "company-1", task_id: "task-1", worker_id: "worker-1",
  }).task_id, "task-1");
  assert.throws(() => restoreWorkforceTaskCheckpoint(checkpoint, {
    company_id: "company-2", task_id: "task-1", worker_id: "worker-1",
  }), /company_id mismatch/);
  assert.throws(() => restoreWorkforceTaskCheckpoint(checkpoint, {
    company_id: "company-1", task_id: "task-2", worker_id: "worker-1",
  }), /task_id mismatch/);
  assert.throws(() => restoreWorkforceTaskCheckpoint(checkpoint, {
    company_id: "company-1", task_id: "task-1", worker_id: "worker-2",
  }), /worker_id mismatch/);
});

test("advances revision monotonically and preserves source-of-truth references", () => {
  const first = createWorkforceTaskCheckpoint({ projection: projection(), pending_operation_ids: ["op-1"] });
  const second = advanceWorkforceTaskCheckpoint(first, {
    state: "paused",
    step: "evidence-captured",
    completed_steps: ["arrive", "inspect"],
    pending_operation_ids: [],
    last_event_id: "event-9",
    updated_at: "2026-09-13T08:46:00+10:00",
  });
  assert.equal(second.checkpoint_revision, 2);
  assert.equal(second.state, "paused");
  assert.deepEqual(second.source_versions, first.source_versions);
  assert.deepEqual(second.pending_operation_ids, []);
  assert.equal(second.policies.canonical_records_remain_source_of_truth, true);
});

test("checkpoint remains authority-neutral across offline restart", () => {
  const checkpoint = createWorkforceTaskCheckpoint({ projection: projection() });
  const serialized = JSON.stringify(checkpoint);
  const restored = restoreWorkforceTaskCheckpoint(JSON.parse(serialized), {
    company_id: "company-1", task_id: "task-1", worker_id: "worker-1",
  });
  assert.equal(restored.policies.checkpoint_is_not_authority, true);
  assert.equal(restored.schema, "titan.workforce.task-checkpoint/v1");
});
