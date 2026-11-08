
import test from "node:test";
import assert from "node:assert/strict";
import {
  DISTRIBUTION_FAMILIES,
  VERTICAL_PROFILE_SLOTS,
  buildDistributionCoverageSnapshot,
} from "../.test-dist/distribution-catalog.js";

test("launch catalogue represents all families and distinct technical adapters", () => {
  assert.equal(DISTRIBUTION_FAMILIES.length, 20);
  const adapterIds = DISTRIBUTION_FAMILIES.flatMap((family) => family.adapter_ids);
  assert.equal(adapterIds.length, 21);
  assert.equal(new Set(adapterIds).size, 21);
  const aiHosts = DISTRIBUTION_FAMILIES.find((family) => family.family_id === "ai-host-distribution");
  assert.deepEqual(aiHosts.adapter_ids, ["chatgpt", "claude"]);
});

test("coverage snapshot enumerates 300 configurations and 6300 adapter projections without certifying gaps", () => {
  const snapshot = buildDistributionCoverageSnapshot();
  assert.equal(snapshot.foundation_configurations.length, 300);
  assert.equal(snapshot.adapter_projections.length, 6300);
  assert.equal(new Set(snapshot.foundation_configurations.map((row) => row.configuration_id)).size, 300);
  assert.equal(new Set(snapshot.adapter_projections.map((row) => row.projection_id)).size, 6300);
  assert.ok(snapshot.foundation_configurations.every((row) => row.disposition === "BLOCKED" && row.input_revisions === null));
  assert.ok(snapshot.adapter_projections.every((row) => row.disposition === "BLOCKED" && row.adapter_revision === null));
  assert.equal(VERTICAL_PROFILE_SLOTS.filter((slot) => slot.disposition === "IDENTITY_PENDING").length, 10);
  assert.ok(VERTICAL_PROFILE_SLOTS.every((slot) => slot.disposition === "IDENTITY_PENDING" ? slot.label === null : slot.canonical_ref === null));
});

test("coverage snapshot binds the exact canonical issue-body digests", () => {
  assert.deepEqual(buildDistributionCoverageSnapshot().source_issue_body_hashes, [
    { issue: 719, sha256: "65aa851baa2a8f3e247641c8787da0f1d4520831e4c3124282ef013e1482d97c" },
    { issue: 1042, sha256: "763bdcf31676d2a657c25847676a4a74931432346c62afbcd3ec189cf962a1b9" },
    { issue: 1068, sha256: "da5b8a5a674a8463251beb2eff9154f1e6d0c8b49671ad12e7a3b38a013e513f" },
  ]);
});
