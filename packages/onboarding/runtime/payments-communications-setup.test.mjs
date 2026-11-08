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
  const database = memoryDatabase();
  const authority = createPaymentsCommunicationsSetupAuthority({
    database,
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
  const record = await database.getRecord({ company_id: "company-a" }, {
    module_id: "titan.onboarding",
    collection: "payments-communications-setup",
    record_id: "canonical",
  });
  assert.equal(record.provenance.provider_settings_owner, "@titan-zero/titan-platform/settings/ai-provider-control-centre");
  assert.equal(record.provenance.notification_settings_owner, "@titan-zero/titan-platform/settings/notification-escalation-settings");
  assert.equal(record.data.notifications.settings_owner, "@titan-zero/titan-platform/settings/notification-escalation-settings");
  assert.equal(record.data.credentials_stored_in_onboarding, false);
  assert.equal(record.data.authority_granted, false);
  assert.equal((await authority.read({ company_id: "company-b" })).payments, null);
  await assert.rejects(
    () => authority.save({ company_id: "company-a" }, {
      company_id: "company-b",
      payments: { methods: ["cash"] },
    }),
    /Cross-company payments\/communications setup payload rejected/,
  );
});

test("payment method normalization rejects case-insensitive duplicates without writing a record", async () => {
  const database = memoryDatabase();
  const authority = createPaymentsCommunicationsSetupAuthority({
    database,
    nativeContributions: [{ id: "channel.email", title: "Email" }],
  });
  await assert.rejects(
    () => authority.save({ company_id: "company-a" }, {
      payments: { methods: ["CASH", " cash "] },
      communications: { channels: ["channel.email"] },
    }),
    /duplicate payment method: cash/,
  );
  assert.equal((await authority.read({ company_id: "company-a" })).revision, 0);
  await assert.rejects(
    () => authority.save({ company_id: "company-a" }, {
      payments: { methods: "cash" },
      communications: { channels: ["channel.email"] },
    }),
    /at least one payment method is required/,
  );
  assert.equal((await authority.read({ company_id: "company-a" })).payments, null);
});

test("setup rejects unknown channels and stale revisions without crossing company boundaries", async () => {
  const database = memoryDatabase();
  const authority = createPaymentsCommunicationsSetupAuthority({
    database,
    nativeContributions: [{ id: "channel.email", title: "Email" }],
  });
  const context = { company_id: "company-a" };
  const valid = {
    payments: { methods: ["CASH"] },
    communications: { channels: ["channel.email"] },
  };
  await assert.rejects(
    () => authority.save(context, {
      ...valid, communications: { channels: ["channel.unknown"] },
    }),
    /unknown communication capability/,
  );
  assert.equal((await authority.read(context)).revision, 0);
  const saved = await authority.save(context, { ...valid, expected_revision: 0 });
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.payment_methods, ["cash"]);
  await assert.rejects(
    () => authority.save(context, { ...valid, expected_revision: 0 }),
    /revision mismatch/,
  );
  assert.equal((await authority.read(context)).revision, 1);
  assert.equal((await authority.read({ company_id: "company-b" })).revision, 0);
});

test("workforce notification defaults are authority-owned, not supplied by the save caller", async () => {
  const database = memoryDatabase();
  const authority = createPaymentsCommunicationsSetupAuthority({
    database,
    nativeContributions: [{ id: "channel.email", title: "Email" }],
    workforceGlobalDefaults: {
      notifications: {
        max_delivery_attempts: 2,
        max_escalation_depth: 1,
        cooldown_ms: 600000,
        ack_minutes_by_urgency: { HIGH: 15 },
      },
    },
  });
  const context = { company_id: "company-a" };
  const input = {
    payments: { methods: ["cash"] },
    communications: { channels: ["channel.email"] },
    notifications: {
      max_delivery_attempts: 10,
      max_escalation_depth: 5,
      cooldown_ms: 1000,
      ack_minutes_by_urgency: { HIGH: 90 },
      automatic_dispatch: true,
    },
  };
  await assert.rejects(
    () => authority.save(context, {
      ...input, workforceGlobalDefaults: { notifications: { max_delivery_attempts: 10 } },
    }),
    /workforceGlobalDefaults must be configured by the onboarding authority/,
  );
  assert.equal((await authority.read(context)).revision, 0);
  const saved = await authority.save(context, input);
  assert.equal(saved.revision, 1);
  const stored = (await authority.read(context)).notifications;
  assert.equal(stored.max_delivery_attempts, 2);
  assert.equal(stored.max_escalation_depth, 1);
  assert.equal(stored.cooldown_ms, 600000);
  assert.equal(stored.ack_minutes_by_urgency.HIGH, 15);
  assert.equal(stored.automatic_dispatch, false);
  assert.equal(stored.dispatch_permitted, false);
  assert.equal(stored.settings_can_grant_authority, false);
});
