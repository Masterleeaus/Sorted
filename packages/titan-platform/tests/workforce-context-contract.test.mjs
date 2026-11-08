import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKFORCE_CONTEXT_SCHEMA,
  assertWorkforceContextCompany,
  createWorkforceContextContract,
} from "../.context-test-dist/contract.js";

const base = () => ({
  company_id: "company-1",
  objective_id: "objective-1",
  correlation_id: "corr-1",
  sources: [
    { kind: "customer", id: "customer-1", version: 4 },
    { kind: "job", id: "job-1" },
  ],
  authority: {
    actor_id: "user-1",
    actor_role: "owner",
    authority_source: "workforce-command-gateway",
    authority_revision: "r7",
  },
});

test("creates bounded context references without copying business records", () => {
  const context = createWorkforceContextContract(base());
  assert.equal(context.schema, WORKFORCE_CONTEXT_SCHEMA);
  assert.equal(context.company_id, "company-1");
  assert.deepEqual(context.sources.map(({ kind, id }) => ({ kind, id })), [
    { kind: "customer", id: "customer-1" },
    { kind: "job", id: "job-1" },
  ]);
  assert.equal(context.policies.context_is_projection_not_database, true);
  assert.equal(context.policies.canonical_records_remain_source_of_truth, true);
  assert.equal(context.policies.context_is_not_authority, true);
});

test("rejects legacy tenant aliases as an authority boundary", () => {
  assert.throws(
    () => createWorkforceContextContract({ ...base(), tenant_id: "legacy" }),
    /legacy tenant aliases/,
  );
});

test("fails closed on cross-company context use", () => {
  const context = createWorkforceContextContract(base());
  assert.equal(assertWorkforceContextCompany("company-1", context), "company-1");
  assert.throws(() => assertWorkforceContextCompany("company-2", context), /company_id mismatch/);
});

test("rejects duplicate context record references", () => {
  const input = base();
  input.sources = [...input.sources, { kind: "job", id: "job-1" }];
  assert.throws(() => createWorkforceContextContract(input), /duplicate workforce context source/);
});

test("requires explicit authority provenance", () => {
  const input = base();
  input.authority = { ...input.authority, authority_source: "" };
  assert.throws(() => createWorkforceContextContract(input), /authority.authority_source is required/);
});
