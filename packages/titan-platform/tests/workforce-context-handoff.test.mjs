import assert from "node:assert/strict";
import test from "node:test";
import { assembleWorkforceContext } from "../../.tmp-wf-context-build/assembler.js";
import { projectWorkforceContextForTask } from "../../.tmp-wf-context-build/projection.js";
import { createWorkforceTaskCheckpoint } from "../../.tmp-wf-context-build/checkpoint.js";
import { createWorkforceContextHandoff } from "../../.tmp-wf-context-build/handoff.js";

function projected() {
  const context = assembleWorkforceContext({
    company_id: "company-1",
    objective_id: "objective-1",
    task_id: "task-1",
    correlation_id: "corr-1",
    actor: { id: "agent-sales", company_id: "company-1", role: "sales-agent" },
    authority: { source: "business-ops-authority", revision: 7 },
    customer: { id: "cust-1", company_id: "company-1", version: 2 },
    workflow: { id: "wf-1", company_id: "company-1", version: 4 },
  });
  return projectWorkforceContextForTask(context, {
    company_id: "company-1", task_id: "task-1", worker_id: "worker-sales-1",
    purpose: "prepare quote handoff", allowed_sources: ["customer", "workflow"],
    field_grants: [
      { source_kind: "customer", fields: ["display_name"] },
      { source_kind: "workflow", fields: ["stage"] },
    ],
  });
}

test("creates summary-only handoff with causality decisions unresolved items and authority", () => {
  const projection = projected();
  const checkpoint = createWorkforceTaskCheckpoint({ projection });
  const handoff = createWorkforceContextHandoff({
    projection,
    checkpoint,
    to_agent_id: "quote-agent",
    summary: "Lead qualified and ready for quoting.",
    causal_links: ["lead:lead-1", "workflow:wf-1"],
    decisions: [{ id: "d1", summary: "Residential quote required", decided_by: "agent-sales", authority_source: "business-ops-authority", authority_revision: 7 }],
    unresolved_items: [{ id: "u1", summary: "Confirm preferred service date", owner_hint: "quote-agent" }],
    created_at: "2026-09-13T08:50:00+10:00",
  });
  assert.equal(handoff.to_agent_id, "quote-agent");
  assert.equal(handoff.checkpoint_revision, 1);
  assert.equal(handoff.decisions[0].authority_source, "business-ops-authority");
  assert.equal(handoff.policies.handoff_is_not_authority, true);
  assert.equal("customer_payload" in handoff, false);
});

test("rejects checkpoint from another company task or worker", () => {
  const projection = projected();
  const checkpoint = createWorkforceTaskCheckpoint({ projection });
  assert.throws(() => createWorkforceContextHandoff({
    projection: { ...projection, company_id: "company-2" }, checkpoint, to_agent_id: "x", summary: "x",
  }), /checkpoint company_id mismatch/);
  assert.throws(() => createWorkforceContextHandoff({
    projection: { ...projection, task_id: "task-2" }, checkpoint, to_agent_id: "x", summary: "x",
  }), /checkpoint task_id mismatch/);
  assert.throws(() => createWorkforceContextHandoff({
    projection: { ...projection, worker_id: "worker-2" }, checkpoint, to_agent_id: "x", summary: "x",
  }), /checkpoint worker_id mismatch/);
});

test("rejects missing decision authority provenance", () => {
  assert.throws(() => createWorkforceContextHandoff({
    projection: projected(), to_agent_id: "quote-agent", summary: "x",
    decisions: [{ id: "d1", summary: "x", decided_by: "agent-sales", authority_source: "" }],
  }), /decision.authority_source is required/);
});

test("rejects duplicate decision and unresolved item identities", () => {
  assert.throws(() => createWorkforceContextHandoff({
    projection: projected(), to_agent_id: "quote-agent", summary: "x",
    decisions: [
      { id: "d1", summary: "a", decided_by: "agent-sales", authority_source: "auth" },
      { id: "d1", summary: "b", decided_by: "agent-sales", authority_source: "auth" },
    ],
  }), /duplicate handoff decision id/);
  assert.throws(() => createWorkforceContextHandoff({
    projection: projected(), to_agent_id: "quote-agent", summary: "x",
    unresolved_items: [{ id: "u1", summary: "a" }, { id: "u1", summary: "b" }],
  }), /duplicate unresolved item id/);
});

test("rejects business payload and legacy tenant authority fields", () => {
  assert.throws(() => createWorkforceContextHandoff({ projection: projected(), to_agent_id: "x", summary: "x", business_payload: {} }), /business_payload is not allowed/);
  assert.throws(() => createWorkforceContextHandoff({ projection: projected(), to_agent_id: "x", summary: "x", tenant_company_id: "legacy" }), /tenant_company_id is not allowed/);
});
