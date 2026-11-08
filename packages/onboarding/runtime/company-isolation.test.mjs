import assert from "node:assert/strict";
import test from "node:test";
import { createBusinessSetupAuthority } from "./business-setup-authority.mjs";

function createDatabase() {
  const records = new Map();
  const key = (context, locator) => `${context.company_id}:${locator.module_id}:${locator.collection}:${locator.record_id}`;
  return {
    async getRecord(context, locator) { return records.get(key(context, locator)) ?? null; },
    async putRecord(context, record) {
      assert.equal(record.data.company_id, context.company_id);
      const next = { ...record, version: Number(records.get(key(context, record))?.version ?? 0) + 1 };
      records.set(key(context, record), next);
      return next;
    },
  };
}

test("onboarding reads remain company-scoped and reject substituted company payloads", async () => {
  const authority = createBusinessSetupAuthority({
    database: createDatabase(), settingsAdapter: { read: async () => null, write: async () => undefined },
    settingsRegistry: { settings: [] }, clock: () => 1,
  });
  await authority.save({ company_id: "company-a" }, { identity: { legal_name: "Company A" } });
  assert.equal((await authority.read({ company_id: "company-a" })).identity.legal_name, "Company A");
  assert.equal((await authority.read({ company_id: "company-b" })).identity, null);
  await assert.rejects(() => authority.save({ company_id: "company-a" }, {
    company_id: "company-b", identity: { legal_name: "Company B" },
  }), /Cross-company business setup payload rejected/);
});
