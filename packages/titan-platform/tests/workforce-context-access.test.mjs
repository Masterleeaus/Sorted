import assert from "node:assert/strict";
import test from "node:test";
import { assembleWorkforceContext } from "../../.tmp-wf-context-build/assembler.js";
import { projectWorkforceContextForTask } from "../../.tmp-wf-context-build/projection.js";
import { applyWorkforceContextPermissions } from "../../.tmp-wf-context-build/access.js";

function projection() {
  const ctx = assembleWorkforceContext({
    company_id: "company-1", objective_id: "obj-1", task_id: "task-1",
    actor: { id: "manager-1", company_id: "company-1", role: "manager" },
    authority: { source: "authority", revision: 1 },
    customer: { id: "cust-1", company_id: "company-1", version: 1 },
    location: { id: "loc-1", company_id: "company-1", version: 1 },
  });
  return projectWorkforceContextForTask(ctx, {
    company_id: "company-1", task_id: "task-1", worker_id: "worker-1", purpose: "visit",
    allowed_sources: ["customer", "location"],
    field_grants: [
      { source_kind: "customer", fields: ["display_name", "phone", "email"] },
      { source_kind: "location", fields: ["service_address", "access_code"] },
    ],
  });
}

test("intersects requested fields with explicit permission grants", () => {
  const result = applyWorkforceContextPermissions(projection(), {
    company_id: "company-1", worker_id: "worker-1", source: "rbac", revision: 3,
    grants: [
      { source_kind: "customer", fields: ["display_name", "phone"] },
      { source_kind: "location", fields: ["service_address"] },
    ],
    sensitive_fields: [
      { source_kind: "customer", fields: ["phone", "email"] },
      { source_kind: "location", fields: ["access_code"] },
    ],
  }, "2026-09-13T09:05:00+10:00");
  assert.deepEqual(result.effective_field_grants, [
    { source_kind: "customer", fields: ["display_name", "phone"] },
    { source_kind: "location", fields: ["service_address"] },
  ]);
  assert.deepEqual(result.audit.denied_fields, [
    { source_kind: "customer", field: "email" },
    { source_kind: "location", field: "access_code" },
  ]);
  assert.equal(result.audit.policies.audit_contains_no_protected_values, true);
});

test("identity does not grant fields absent from permissions", () => {
  const result = applyWorkforceContextPermissions({ ...projection(), worker_id: "admin-worker" }, {
    company_id: "company-1", worker_id: "admin-worker", source: "rbac", grants: [],
  });
  assert.deepEqual(result.effective_field_grants, []);
});

test("fails closed on company or worker mismatch", () => {
  assert.throws(() => applyWorkforceContextPermissions(projection(), { company_id: "company-2", worker_id: "worker-1", source: "rbac", grants: [] }), /company_id mismatch/);
  assert.throws(() => applyWorkforceContextPermissions(projection(), { company_id: "company-1", worker_id: "worker-2", source: "rbac", grants: [] }), /worker_id mismatch/);
});

test("audit records names and reasons but no business values", () => {
  const result = applyWorkforceContextPermissions(projection(), {
    company_id: "company-1", worker_id: "worker-1", source: "rbac", grants: [],
  });
  const serialized = JSON.stringify(result.audit);
  assert.equal(serialized.includes("cust-1"), false);
  assert.equal(serialized.includes("loc-1"), false);
  assert.equal(result.audit.decisions.every((d) => typeof d.reason === "string"), true);
});
