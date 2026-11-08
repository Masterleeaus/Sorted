import assert from "node:assert/strict";
import test from "node:test";
import { assembleWorkforceContext } from "../../.tmp-wf-context-build/assembler.js";
import { projectWorkforceContextForTask } from "../../.tmp-wf-context-build/projection.js";

function context() {
  return assembleWorkforceContext({
    company_id: "company-1",
    objective_id: "objective-1",
    task_id: "task-1",
    correlation_id: "corr-1",
    actor: { id: "manager-1", company_id: "company-1", role: "manager" },
    authority: { source: "business-ops-authority", revision: 2 },
    customer: { id: "cust-1", company_id: "company-1", version: 3 },
    location: { id: "loc-1", company_id: "company-1" },
    job: { id: "job-1", company_id: "company-1", version: 7 },
    workflow: { id: "wf-1", company_id: "company-1" },
  });
}

test("projects only explicitly allowed business sources", () => {
  const result = projectWorkforceContextForTask(context(), {
    company_id: "company-1",
    task_id: "task-1",
    worker_id: "worker-7",
    purpose: "perform assigned visit",
    allowed_sources: ["location", "job"],
    field_grants: [
      { source_kind: "location", fields: ["service_address"] },
      { source_kind: "job", fields: ["status", "scheduled_window"] },
    ],
  });
  assert.deepEqual(result.sources.map((source) => source.kind), ["company", "actor", "location", "job", "authority"]);
  assert.equal(result.policies.default_deny, true);
  assert.equal(result.policies.projection_is_not_authority, true);
});

test("omitted sources stay omitted even when present in canonical context", () => {
  const result = projectWorkforceContextForTask(context(), {
    company_id: "company-1",
    task_id: "task-1",
    worker_id: "worker-7",
    purpose: "check site access",
    allowed_sources: ["location"],
    field_grants: [{ source_kind: "location", fields: ["access_notes"] }],
  });
  assert.equal(result.sources.some((source) => source.kind === "customer"), false);
  assert.equal(result.sources.some((source) => source.kind === "workflow"), false);
});

test("rejects cross-company projection", () => {
  assert.throws(() => projectWorkforceContextForTask(context(), {
    company_id: "company-2", task_id: "task-1", worker_id: "worker-7", purpose: "x",
    allowed_sources: [], field_grants: [],
  }), /company_id mismatch/);
});

test("rejects task mismatch", () => {
  assert.throws(() => projectWorkforceContextForTask(context(), {
    company_id: "company-1", task_id: "task-2", worker_id: "worker-7", purpose: "x",
    allowed_sources: [], field_grants: [],
  }), /task_id does not match/);
});

test("rejects wildcard field access", () => {
  assert.throws(() => projectWorkforceContextForTask(context(), {
    company_id: "company-1", task_id: "task-1", worker_id: "worker-7", purpose: "x",
    allowed_sources: ["job"], field_grants: [{ source_kind: "job", fields: ["*"] }],
  }), /wildcard field grants/);
});

test("rejects field grants for sources not allowed into projection", () => {
  assert.throws(() => projectWorkforceContextForTask(context(), {
    company_id: "company-1", task_id: "task-1", worker_id: "worker-7", purpose: "x",
    allowed_sources: ["job"], field_grants: [{ source_kind: "customer", fields: ["name"] }],
  }), /unavailable source kind/);
});

test("identity alone cannot expand data access", () => {
  const a = projectWorkforceContextForTask(context(), {
    company_id: "company-1", task_id: "task-1", worker_id: "worker-admin", purpose: "x",
    allowed_sources: [], field_grants: [],
  });
  assert.deepEqual(a.sources.map((source) => source.kind), ["company", "actor", "authority"]);
});
