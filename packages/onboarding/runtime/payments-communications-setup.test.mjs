import assert from "node:assert/strict";
import test from "node:test";
import { createPaymentsCommunicationsSetupAuthority } from "./payments-communications-setup.mjs";
import { projectProviderControlCentre } from "@titan-zero/titan-platform/settings/ai-provider-control-centre";
import { projectNotificationEscalationSettings } from "@titan-zero/titan-platform/settings/notification-escalation-settings";

function memoryDatabase() {
  const records = new Map();
  const key = (ctx, locator) => [ctx.company_id, locator.module_id, locator.collection, locator.record_id].join(":");
  return {
    async getRecord(ctx, locator) {
      return records.get(key(ctx, locator)) ?? null;
    },
    async putRecord(ctx, record) {
      assert.equal(ctx.company_id, record.data.company_id);
      const k = key(ctx, record);
      const stored = { ...record, version: (records.get(k)?.version ?? 0) + 1 };
      records.set(k, stored);
      return stored;
    },
  };
}

test("onboarding imports the canonical settings projections without granting authority", () => {
  const provider = projectProviderControlCentre({ company_id: "company-a", providerConfigs: [] });
  const notifications = projectNotificationEscalationSettings({ company_id: "company-a" });
  assert.equal(provider.company_id, "company-a");
  assert.equal(provider.grants_authority, false);
  assert.equal(notifications.company_id, "company-a");
  assert.equal(notifications.execution_permitted, false);
  assert.equal(notifications.automatic_dispatch, false);
});

test("payments/communications setup remains isolated by company and configuration-only", async () => {
  const authority = createPaymentsCommunicationsSetupAuthority({
    database: memoryDatabase(),
    nativeContributions: [{ id: "channel.email", title: "Email", risk_class: "low" }],
    clock: () => 12345,
  });
  const saved = await authority.save({ company_id: "company-a" }, {
    payments: { methods: ["cash"] },
    communications: { channels: ["channel.email"] },
    providers: { providerConfigs: [] },
    notifications: {},
  });
  assert.equal(saved.company_id, "company-a");
  assert.equal(saved.authority_granted, false);
  assert.equal(saved.execution_permitted, false);
  assert.equal(saved.credentials_stored_in_onboarding, false);
  assert.equal((await authority.read({ company_id: "company-b" })).payments, null);
  await assert.rejects(
    () => authority.save({ company_id: "company-a" }, {
      company_id: "company-b",
      payments: { methods: ["cash"] },
    }),
    /Cross-company payments\/communications setup payload rejected/,
  );
});
