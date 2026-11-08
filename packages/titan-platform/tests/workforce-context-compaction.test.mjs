import assert from "node:assert/strict";
import test from "node:test";
import { assembleWorkforceContext } from "../../.tmp-wf-context-build/assembler.js";
import { projectWorkforceContextForTask } from "../../.tmp-wf-context-build/projection.js";
import { createWorkforceTaskCheckpoint } from "../../.tmp-wf-context-build/checkpoint.js";
import { assertWorkforceContextCompactActive, compactWorkforceContext, reconstructWorkforceContext } from "../../.tmp-wf-context-build/compaction.js";

function projection() {
  const ctx = assembleWorkforceContext({
    company_id: "company-1", objective_id: "obj-1", task_id: "task-1", correlation_id: "corr-1",
    actor: { id: "actor-1", company_id: "company-1", role: "dispatcher", version: 2 },
    authority: { source: "authority", revision: 3 },
    customer: { id: "cust-1", company_id: "company-1", version: 4 },
    job: { id: "job-1", company_id: "company-1", version: 8 },
  });
  return projectWorkforceContextForTask(ctx, {
    company_id: "company-1", task_id: "task-1", worker_id: "worker-1", purpose: "perform job",
    allowed_sources: ["customer", "job"],
    field_grants: [{ source_kind: "job", fields: ["status"] }, { source_kind: "customer", fields: ["display_name"] }],
  });
}
function canonical() { return [
  { kind: "actor", id: "actor-1", company_id: "company-1", role: "dispatcher", version: 2 },
  { kind: "customer", id: "cust-1", company_id: "company-1", version: 4 },
  { kind: "job", id: "job-1", company_id: "company-1", version: 8 },
]; }

test("compacts deterministically without business payload", () => {
  const p = projection(); const cp = createWorkforceTaskCheckpoint({ projection: p });
  const a = compactWorkforceContext(p, { created_at: "2026-09-13T09:10:00+10:00", expires_at: "2026-09-13T10:10:00+10:00", checkpoint: cp });
  const b = compactWorkforceContext(p, { created_at: "2026-09-13T09:10:00+10:00", expires_at: "2026-09-13T10:10:00+10:00", checkpoint: cp });
  assert.deepEqual(a, b);
  assert.equal(a.policies.compact_contains_no_business_payload, true);
  assert.equal("customer_payload" in a, false);
});

test("reconstructs same bounded projection from canonical records", () => {
  const original = projection();
  const compact = compactWorkforceContext(original, { created_at: "2026-09-13T09:10:00+10:00", expires_at: "2026-09-13T10:10:00+10:00" });
  const rebuilt = reconstructWorkforceContext(compact, canonical(), "2026-09-13T09:30:00+10:00");
  assert.deepEqual(rebuilt.sources, original.sources);
  assert.deepEqual(rebuilt.field_grants, [...original.field_grants].sort((a,b)=>a.source_kind.localeCompare(b.source_kind)));
  assert.equal(rebuilt.worker_id, original.worker_id);
});

test("expired compact fails closed", () => {
  const compact = compactWorkforceContext(projection(), { created_at: "2026-09-13T09:10:00+10:00", expires_at: "2026-09-13T10:10:00+10:00" });
  assert.throws(() => assertWorkforceContextCompactActive(compact, "2026-09-13T10:10:00+10:00"), /expired/);
  assert.throws(() => reconstructWorkforceContext(compact, canonical(), "2026-09-13T11:00:00+10:00"), /expired/);
});

test("reconstruction rejects missing, cross-company, or changed canonical records", () => {
  const compact = compactWorkforceContext(projection(), { created_at: "2026-09-13T09:10:00+10:00", expires_at: "2026-09-13T10:10:00+10:00" });
  assert.throws(() => reconstructWorkforceContext(compact, canonical().filter((x)=>x.kind!=="job"), "2026-09-13T09:30:00+10:00"), /record missing/);
  const cross = canonical(); cross[2] = { ...cross[2], company_id: "company-2" };
  assert.throws(() => reconstructWorkforceContext(compact, cross, "2026-09-13T09:30:00+10:00"), /company_id mismatch/);
  const changed = canonical(); changed[2] = { ...changed[2], version: 9 };
  assert.throws(() => reconstructWorkforceContext(compact, changed, "2026-09-13T09:30:00+10:00"), /version changed/);
});
