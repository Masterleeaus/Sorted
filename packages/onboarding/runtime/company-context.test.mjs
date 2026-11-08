import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCompanyContext } from "@titan-zero/storage/company-context";

test("canonical contexts require and preserve the resolved company id", () => {
  const context = normalizeCompanyContext({ company_id: "company-a", actor_id: "actor-1", context_revision: "7" });
  assert.deepEqual(context, { company_id: "company-a", actor_id: "actor-1", context_revision: "7" });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(normalizeCompanyContext({ company_id: "company-b" }).company_id, "company-b");
});

test("canonical contexts reject missing, malformed, or nested legacy company boundaries", () => {
  assert.throws(() => normalizeCompanyContext({}), /company_id/);
  assert.throws(() => normalizeCompanyContext({ company_id: "x" }), /company_id/);
  assert.throws(() => normalizeCompanyContext({ company_id: "company-a", nested: { tenant_id: "company-b" } }), /legacy tenant boundary/);
});
