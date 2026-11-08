import test from "node:test";
import assert from "node:assert/strict";

import {
  createOfflineResilienceInventory,
  offlineCapabilitiesForPass,
} from "../.test-dist/offline/index.js";

const ctx = (company_id = "company-a", extra = {}) => ({
  company_id,
  actor_id: "actor-1",
  operation_id: "offline-pass1",
  ...extra,
});

test("offline inventory is company scoped and authority neutral", () => {
  const inventory = createOfflineResilienceInventory(ctx());
  assert.equal(inventory.company_id, "company-a");
  assert.equal(inventory.company_boundary, "company_id");
  assert.equal(inventory.identity_grants_authority, false);
  assert.equal(inventory.execution_authority, false);
  assert.equal(inventory.server_grants_authority, false);
  assert.equal(inventory.automatic_effect_replay, false);
});

test("offline inventory rejects legacy tenant boundaries", () => {
  assert.throws(
    () => createOfflineResilienceInventory(ctx("company-a", { tenant_id: "legacy" })),
    /legacy tenant boundary/i,
  );
});

test("offline inventory classifies retained extension bootstrap as adapter-required not authority", () => {
  const inventory = createOfflineResilienceInventory(ctx());
  const bootstrap = inventory.capabilities.find((item) => item.id === "extension_background_bootstrap");
  assert.equal(bootstrap.state, "browser_adapter_required");
  assert.equal(inventory.extension_background_is_native_authority, false);
});

test("offline inventory identifies native checkpoint storage and donor reuse runway", () => {
  const inventory = createOfflineResilienceInventory(ctx());
  assert.equal(inventory.counts.native, 1);
  assert.ok(inventory.counts.portable_donor >= 10);
  assert.ok(inventory.counts.gap >= 5);
  const checkpoint = inventory.capabilities.find((item) => item.id === "company_checkpoint_storage");
  assert.equal(checkpoint.state, "native");
});

test("offline pass runway maps queue/retry work to pass 3 and sync work to pass 4", () => {
  const pass3 = offlineCapabilitiesForPass(3).map((item) => item.id);
  const pass4 = offlineCapabilitiesForPass(4).map((item) => item.id);
  assert.ok(pass3.includes("durable_mutation_queue"));
  assert.ok(pass3.includes("conflict_retry_policy"));
  assert.ok(pass3.includes("retry_budget"));
  assert.deepEqual(pass4, ["snapshot_pull_apply_revision_sync"]);
});

test("invalid offline pass selection fails closed", () => {
  assert.throws(() => offlineCapabilitiesForPass(0), /integer from 1 to 10/i);
  assert.throws(() => offlineCapabilitiesForPass(11), /integer from 1 to 10/i);
});
