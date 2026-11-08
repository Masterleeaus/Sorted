import assert from "node:assert/strict";
import test from "node:test";
import { assembleWorkforceContext } from "../../.tmp-wf-context-build/assembler.js";

const base = () => ({
  company_id: "company-1",
  objective_id: "obj-1",
  correlation_id: "corr-1",
  task_id: "task-1",
  actor: { id: "user-1", company_id: "company-1", role: "dispatcher", version: 7 },
  authority: { source: "business-ops-authority", revision: 12 },
  customer: { id: "cust-1", company_id: "company-1", version: 3 },
  location: { id: "loc-1", company_id: "company-1" },
  job: { id: "job-1", company_id: "company-1", version: "v8" },
  workflow: { id: "wf-1", company_id: "company-1", observed_at: "2026-09-13T04:00:00+10:00" },
});

test("assembles bounded references and authority provenance", () => {
  const context = assembleWorkforceContext(base());
  assert.equal(context.company_id, "company-1");
  assert.deepEqual(context.sources.map((source) => source.kind), [
    "company", "actor", "customer", "location", "job", "workflow", "authority",
  ]);
  assert.equal(context.authority.actor_id, "user-1");
  assert.equal(context.authority.authority_source, "business-ops-authority");
  assert.equal(context.policies.context_is_projection_not_database, true);
});

test("optional canonical records may be omitted", () => {
  const input = base();
  input.customer = null;
  input.location = null;
  input.job = null;
  input.workflow = null;
  const context = assembleWorkforceContext(input);
  assert.deepEqual(context.sources.map((source) => source.kind), ["company", "actor", "authority"]);
});

test("rejects cross-company actor", () => {
  const input = base();
  input.actor = { ...input.actor, company_id: "company-2" };
  assert.throws(() => assembleWorkforceContext(input), /actor\.company_id does not match/);
});

test("rejects cross-company canonical records", () => {
  const input = base();
  input.job = { ...input.job, company_id: "company-2" };
  assert.throws(() => assembleWorkforceContext(input), /job\.company_id does not match/);
});

test("rejects legacy tenant aliases", () => {
  const input = { ...base(), tenant_id: "legacy" };
  assert.throws(() => assembleWorkforceContext(input), /legacy tenant aliases/);
});

test("identity does not replace authority provenance", () => {
  const input = base();
  input.authority = { source: "" };
  assert.throws(() => assembleWorkforceContext(input), /authority\.source is required/);
});
