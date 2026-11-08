import test from "node:test";import assert from "node:assert/strict";import {createHash} from "node:crypto";import {createDistributionManifest,transitionDistribution,verifyDistributionArtifact,projectMatrix} from "../.test-dist/distribution-gateway.js";
const base={company_id:"co-1",product_ref:"quote",vertical_ref:"hvac:v1",tier_ref:"free",capability_ids:["quote.create"],contract_versions:["api:v1"],artifact_hash:"sha256:0000000000000000000000000000000000000000000000000000000000000000",provenance_ref:"build:1"};
test("builds authority-neutral manifests and deterministic matrix projections",()=>{const m=createDistributionManifest({...base,manifest_id:"m-1",platform:"AI_HOST"});assert.equal(m.state,"BUILT");assert.equal(m.schema,"titan.distribution-manifest.v1");assert.equal(m.authorityGranted,false);assert.deepEqual(projectMatrix(base,["AI_HOST","BROWSER_EXTENSION"]).map(x=>x.platform),["AI_HOST","BROWSER_EXTENSION"]);});
test("requires verification before submission and publication",()=>{const m=createDistributionManifest({...base,manifest_id:"m-1",platform:"DEVELOPER_SDK"});assert.throws(()=>transitionDistribution(m,"PUBLISHED"),/transition/);const published=transitionDistribution(transitionDistribution(transitionDistribution(m,"VERIFIED"),"READY_TO_SUBMIT"),"SUBMITTED");assert.equal(published.state,"SUBMITTED");});

test("rejects incomplete references and malformed artifact hashes", () => {
  assert.throws(() => createDistributionManifest({ ...base, manifest_id: "m-1", product_ref: " ", platform: "AI_HOST" }), /product_ref-required/);
  assert.throws(() => createDistributionManifest({ ...base, manifest_id: "m-1", artifact_hash: "sha256:1", platform: "AI_HOST" }), /artifact-hash-invalid/);
  assert.throws(() => createDistributionManifest({ ...base, manifest_id: "m-1", capability_ids: ["quote.create", "quote.create"], platform: "AI_HOST" }), /capability-id-duplicate/);
});

test("freezes a normalized copy and rejects duplicate matrix adapters", () => {
  const capabilities = ["quote.create"];
  const manifest = createDistributionManifest({ ...base, capability_ids: capabilities, manifest_id: "m-2", platform: "DEVELOPER_SDK" });
  capabilities.push("quote.update");
  assert.deepEqual(manifest.capability_ids, ["quote.create"]);
  assert.equal(Object.isFrozen(manifest.capability_ids), true);
  assert.throws(() => projectMatrix(base, ["AI_HOST", "AI_HOST"]), /distribution-profile-duplicate/);
});

test("normalizes reference arrays with locale-independent ordering", () => {
  const manifest = createDistributionManifest({
    ...base,
    manifest_id: "m-3",
    platform: "AI_HOST",
    capability_ids: ["z.capability", "A.capability"],
    contract_versions: ["v2", "v10"],
  });
  assert.deepEqual(manifest.capability_ids, ["A.capability", "z.capability"]);
  assert.deepEqual(manifest.contract_versions, ["v10", "v2"]);
});

test("verifies exact generated artifact bytes before marking the distribution verified", () => {
  const artifactBytes = Buffer.from("offline-sdk-package-fixture-v1");
  const artifact_hash = "sha256:" + createHash("sha256").update(artifactBytes).digest("hex");
  const manifest = createDistributionManifest({ ...base, manifest_id: "m-artifact", platform: "DEVELOPER_SDK", artifact_hash });

  assert.throws(() => verifyDistributionArtifact(manifest, Buffer.from("tampered-package")), /artifact-hash-mismatch/);
  assert.throws(() => verifyDistributionArtifact(manifest, Buffer.alloc(0)), /artifact-bytes-empty/);
  assert.equal(manifest.state, "BUILT");
  assert.equal(verifyDistributionArtifact(manifest, artifactBytes).state, "VERIFIED");
});

test("published distributions can be revoked terminally without changing prior snapshots", () => {
  const built = createDistributionManifest({ ...base, manifest_id: "m-revoke", platform: "DEVELOPER_SDK" });
  const verified = transitionDistribution(built, "VERIFIED");
  const ready = transitionDistribution(verified, "READY_TO_SUBMIT");
  const submitted = transitionDistribution(ready, "SUBMITTED");
  const reviewing = transitionDistribution(submitted, "REVIEWING");
  const published = transitionDistribution(reviewing, "PUBLISHED");
  const revoked = transitionDistribution(published, "REVOKED");
  const superseded = transitionDistribution(published, "SUPERSEDED");
  const supersededRevoked = transitionDistribution(superseded, "REVOKED");

  assert.equal(revoked.state, "REVOKED");
  assert.equal(supersededRevoked.state, "REVOKED");
  assert.equal(published.state, "PUBLISHED");
  assert.throws(() => transitionDistribution(revoked, "BUILT"), /distribution-transition-invalid/);
  assert.throws(() => transitionDistribution(revoked, "RETIRED"), /distribution-transition-invalid/);
});
