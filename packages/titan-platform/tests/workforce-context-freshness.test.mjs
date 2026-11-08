import assert from "node:assert/strict";
import test from "node:test";
import { assembleWorkforceContext } from "../../.tmp-wf-context-build/assembler.js";
import { projectWorkforceContextForTask } from "../../.tmp-wf-context-build/projection.js";
import { createWorkforceTaskCheckpoint } from "../../.tmp-wf-context-build/checkpoint.js";
import { assertWorkforceContextFreshForWrite, checkWorkforceContextFreshness } from "../../.tmp-wf-context-build/freshness.js";

function context() {
  return assembleWorkforceContext({
    company_id: "company-1", objective_id: "objective-1", task_id: "task-1",
    actor: { id: "actor-1", company_id: "company-1", role: "dispatcher", version: 2 },
    authority: { source: "business-ops-authority", revision: 7 },
    customer: { id: "cust-1", company_id: "company-1", version: 3 },
    job: { id: "job-1", company_id: "company-1", version: 8 },
  });
}
function checkpoint() {
  const projection = projectWorkforceContextForTask(context(), {
    company_id: "company-1", task_id: "task-1", worker_id: "worker-1", purpose: "work",
    allowed_sources: ["customer", "job"], field_grants: [],
  });
  return createWorkforceTaskCheckpoint({ projection });
}
function canonical(jobVersion = 8, customerVersion = 3) {
  return [
    { kind: "actor", id: "actor-1", company_id: "company-1", version: 2 },
    { kind: "customer", id: "cust-1", company_id: "company-1", version: customerVersion },
    { kind: "job", id: "job-1", company_id: "company-1", version: jobVersion },
  ];
}

test("reports fresh when canonical versions match", () => {
  const report = checkWorkforceContextFreshness({ context: context(), canonical_records: canonical(), checked_at: "2026-09-13T09:00:00+10:00" });
  assert.equal(report.status, "fresh");
  assert.doesNotThrow(() => assertWorkforceContextFreshForWrite(report));
});

test("marks changed canonical version stale and blocks write", () => {
  const report = checkWorkforceContextFreshness({ context: context(), canonical_records: canonical(9) });
  assert.equal(report.status, "refresh_required");
  assert.equal(report.findings.find((x) => x.kind === "job")?.status, "stale");
  assert.throws(() => assertWorkforceContextFreshForWrite(report), /not fresh for write/);
});

test("reports missing canonical evidence and requires refresh", () => {
  const report = checkWorkforceContextFreshness({ context: context(), canonical_records: canonical().filter((x) => x.kind !== "customer") });
  assert.equal(report.status, "refresh_required");
  assert.equal(report.findings.find((x) => x.kind === "customer")?.status, "missing");
});

test("fails closed on cross-company canonical record evidence", () => {
  const records = canonical(); records[2] = { ...records[2], company_id: "company-2" };
  assert.throws(() => checkWorkforceContextFreshness({ context: context(), canonical_records: records }), /company_id mismatch/);
});

test("detects conflict when context and canonical diverge from checkpoint", () => {
  const cp = checkpoint();
  const changedContext = assembleWorkforceContext({
    company_id: "company-1", objective_id: "objective-1", task_id: "task-1",
    actor: { id: "actor-1", company_id: "company-1", role: "dispatcher", version: 2 },
    authority: { source: "business-ops-authority", revision: 7 },
    customer: { id: "cust-1", company_id: "company-1", version: 4 },
    job: { id: "job-1", company_id: "company-1", version: 10 },
  });
  const report = checkWorkforceContextFreshness({ context: changedContext, checkpoint: cp, canonical_records: canonical(9, 5) });
  assert.equal(report.status, "conflict");
  assert.equal(report.findings.find((x) => x.kind === "job")?.status, "conflict");
  assert.equal(report.policies.version_conflict_never_auto_overwrites, true);
});

test("rejects checkpoint scope mismatch and legacy tenant alias", () => {
  const cp = { ...checkpoint(), company_id: "company-2" };
  assert.throws(() => checkWorkforceContextFreshness({ context: context(), checkpoint: cp, canonical_records: canonical() }), /checkpoint company_id mismatch/);
  assert.throws(() => checkWorkforceContextFreshness({ context: context(), canonical_records: canonical(), tenant_id: "legacy" }), /legacy tenant aliases/);
});
