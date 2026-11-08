import assert from "node:assert/strict";
import test from "node:test";
import { assembleWorkforceContext } from "../../.tmp-wf-context-build/assembler.js";
import { projectWorkforceContextForTask } from "../../.tmp-wf-context-build/projection.js";
import { applyWorkforceContextPermissions } from "../../.tmp-wf-context-build/access.js";
import { checkWorkforceContextFreshness } from "../../.tmp-wf-context-build/freshness.js";
import { buildWorkforceContextDiagnostics } from "../../.tmp-wf-context-build/diagnostics.js";

function setup() {
  const context = assembleWorkforceContext({
    company_id: "company-secret", objective_id: "obj-secret", task_id: "task-secret",
    actor: { id: "actor-secret", company_id: "company-secret", role: "dispatcher", version: 1 },
    authority: { source: "authority-secret", revision: 1 },
    customer: { id: "cust-secret", company_id: "company-secret", version: 2 },
    location: { id: "loc-secret", company_id: "company-secret", version: 1 },
    job: { id: "job-secret", company_id: "company-secret", version: 4 },
  });
  const projection = projectWorkforceContextForTask(context, {
    company_id: "company-secret", task_id: "task-secret", worker_id: "worker-secret", purpose: "work",
    allowed_sources: ["location", "job"],
    field_grants: [{ source_kind: "job", fields: ["status", "private_note"] }],
  });
  const access = applyWorkforceContextPermissions(projection, {
    company_id: "company-secret", worker_id: "worker-secret", source: "rbac-secret",
    grants: [{ source_kind: "job", fields: ["status"] }],
    sensitive_fields: [{ source_kind: "job", fields: ["private_note"] }],
  });
  const freshness = checkWorkforceContextFreshness({ context, canonical_records: [
    { kind: "actor", id: "actor-secret", company_id: "company-secret", version: 1 },
    { kind: "customer", id: "cust-secret", company_id: "company-secret", version: 2 },
    { kind: "location", id: "loc-secret", company_id: "company-secret", version: 1 },
    { kind: "job", id: "job-secret", company_id: "company-secret", version: 5 },
  ] });
  return { context, projection, access, freshness };
}

test("explains selected omitted denied and stale states using safe reason codes", () => {
  const x = setup();
  const d = buildWorkforceContextDiagnostics({ context: x.context, projection: x.projection, access_audit: x.access.audit, freshness: x.freshness });
  assert.equal(d.selected_source_count, 2);
  assert.equal(d.omitted_source_count, 1);
  assert.equal(d.denied_field_count, 1);
  assert.equal(d.freshness_status, "refresh_required");
  assert.equal(d.entries.some((e) => e.outcome === "stale"), true);
  assert.equal(d.entries.some((e) => e.outcome === "denied"), true);
});

test("diagnostic serialization contains no record ids or protected values", () => {
  const x = setup();
  const d = buildWorkforceContextDiagnostics({ context: x.context, projection: x.projection, access_audit: x.access.audit, freshness: x.freshness });
  const s = JSON.stringify(d);
  for (const secret of ["cust-secret", "loc-secret", "job-secret", "actor-secret", "authority-secret", "private_note", "rbac-secret"]) {
    assert.equal(s.includes(secret), false, secret);
  }
  assert.equal(d.policies.no_record_ids, true);
});

test("supports explicit rejection reason codes without raw error payloads", () => {
  const { context } = setup();
  const d = buildWorkforceContextDiagnostics({ context, rejections: [{ source_kind: "job", reason_code: "CROSS_COMPANY_REJECTED" }] });
  assert.equal(d.entries.at(-1).reason_code, "CROSS_COMPANY_REJECTED");
  assert.throws(() => buildWorkforceContextDiagnostics({ context, rejections: [{ reason_code: "contains free text!" }] }), /machine-safe code/);
});
