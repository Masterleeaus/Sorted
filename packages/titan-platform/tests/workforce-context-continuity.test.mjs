import assert from "node:assert/strict";
import test from "node:test";
import { assembleWorkforceContext } from "../../.tmp-wf-context-build/assembler.js";
import { projectWorkforceContextForTask } from "../../.tmp-wf-context-build/projection.js";
import { advanceWorkforceTaskCheckpoint, createWorkforceTaskCheckpoint } from "../../.tmp-wf-context-build/checkpoint.js";
import { createWorkforceContextHandoff } from "../../.tmp-wf-context-build/handoff.js";
import { WORKFORCE_CONTINUITY_FLOW, verifyWorkforceContextContinuity } from "../../.tmp-wf-context-build/continuity.js";

function baseProjection(stage, worker) {
  const ctx = assembleWorkforceContext({
    company_id: "company-1", objective_id: "lead-to-care-1", task_id: `task-${stage}`, correlation_id: "journey-1",
    actor: { id: `agent-${stage}`, company_id: "company-1", role: `${stage}-agent`, version: 1 },
    authority: { source: "business-ops-authority", revision: 10 },
    workflow: { id: "workflow-journey-1", company_id: "company-1", version: 1 },
  });
  return projectWorkforceContextForTask(ctx, {
    company_id: "company-1", task_id: `task-${stage}`, worker_id: worker, purpose: stage,
    allowed_sources: ["workflow"], field_grants: [{ source_kind: "workflow", fields: ["stage"] }],
  });
}

function validFlow() {
  let revision = 0;
  return WORKFORCE_CONTINUITY_FLOW.map((stage, index) => {
    const projection = baseProjection(stage, `worker-${stage}`);
    let checkpoint = createWorkforceTaskCheckpoint({ projection, checkpoint_revision: revision + 1 });
    if (index > 0) checkpoint = { ...checkpoint, checkpoint_revision: revision + 1 };
    revision = checkpoint.checkpoint_revision;
    const handoff = createWorkforceContextHandoff({
      projection, checkpoint, to_agent_id: index === WORKFORCE_CONTINUITY_FLOW.length - 1 ? "journey-complete" : `agent-${WORKFORCE_CONTINUITY_FLOW[index + 1]}`,
      summary: `${stage} stage complete`, causal_links: [`stage:${stage}`],
      decisions: [{ id: `decision-${stage}`, summary: "continue", decided_by: `agent-${stage}`, authority_source: "business-ops-authority", authority_revision: 10 }],
    });
    return { stage, handoff, checkpoint };
  });
}

test("certifies Reception→Sales→Quote→Booking→Scheduling→Jobs→Invoice→Care/Rebooking continuity", () => {
  const report = verifyWorkforceContextContinuity(validFlow());
  assert.equal(report.status, "PASS");
  assert.deepEqual(report.stages, WORKFORCE_CONTINUITY_FLOW);
  assert.equal(report.company_id, "company-1");
  assert.equal(report.correlation_id, "journey-1");
});

test("fails closed if company objective correlation or stage order changes", () => {
  for (const mutation of [
    (flow) => { flow[3] = { ...flow[3], handoff: { ...flow[3].handoff, company_id: "company-2" } }; },
    (flow) => { flow[3] = { ...flow[3], handoff: { ...flow[3].handoff, objective_id: "other" } }; },
    (flow) => { flow[3] = { ...flow[3], handoff: { ...flow[3].handoff, correlation_id: "other" } }; },
    (flow) => { flow[2] = { ...flow[2], stage: "booking" }; },
  ]) {
    const flow = validFlow(); mutation(flow); assert.throws(() => verifyWorkforceContextContinuity(flow));
  }
});

test("fails closed on non-monotonic checkpoint revision", () => {
  const flow = validFlow();
  flow[5] = { ...flow[5], checkpoint: { ...flow[5].checkpoint, checkpoint_revision: flow[4].checkpoint.checkpoint_revision } };
  assert.throws(() => verifyWorkforceContextContinuity(flow), /not monotonic/);
});

test("fails closed if authority-neutral or source-of-truth guards are missing", () => {
  const flow = validFlow();
  flow[1] = { ...flow[1], handoff: { ...flow[1].handoff, policies: { ...flow[1].handoff.policies, handoff_is_not_authority: false } } };
  assert.throws(() => verifyWorkforceContextContinuity(flow), /authority guard missing/);
  const flow2 = validFlow();
  flow2[1] = { ...flow2[1], handoff: { ...flow2[1].handoff, policies: { ...flow2[1].handoff.policies, canonical_records_remain_source_of_truth: false } } };
  assert.throws(() => verifyWorkforceContextContinuity(flow2), /source-of-truth guard missing/);
});
