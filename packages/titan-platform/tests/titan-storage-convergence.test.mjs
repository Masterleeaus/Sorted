import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStorageAdapter, createCompanyRepository } from "../.test-dist/storage/index.js";
import { createStorageReconciler, normalizeStorageContext } from "../.test-dist/storage/index.js";

test("canonical storage context rejects legacy tenant boundaries", () => {
  assert.throws(() => normalizeStorageContext({ company_id: "c1", tenant_id: "c1" }), /legacy tenant boundary/);
  assert.throws(() => normalizeStorageContext({ company_id: "c1", tenant_company_id: "c1" }), /legacy tenant boundary/);
});

test("storage reconciliation is company-scoped and authority-neutral", async () => {
  const repository = createCompanyRepository({ adapter: createMemoryStorageAdapter(), clock: () => 1000 });
  const reconciler = createStorageReconciler({ repository, clock: () => 1000 });
  const context = { company_id: "c1", actor_id: "test" };
  const row = await reconciler.writeLocal(context, {
    module_id: "crm", collection: "customers", record_id: "customer-1",
    data: { name: "Example", company_id: "c1" },
  });
  assert.equal(row.data.company_id, "c1");
  assert.equal(row.data.payload.name, "Example");
  assert.equal(await reconciler.readLocal({ company_id: "c2", actor_id: "test" }, "crm", "customers", "customer-1"), null);
  assert.equal(row.data.authority_neutral, true);
  assert.equal(row.data.grants_authority, false);
  await assert.rejects(() => reconciler.writeLocal(context, {
    module_id: "crm", collection: "customers", record_id: "customer-2",
    data: { name: "Other", company_id: "c2" },
  }), /Cross-company payload rejected/);
});
