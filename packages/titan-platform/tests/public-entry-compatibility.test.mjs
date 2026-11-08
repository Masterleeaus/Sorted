import test from "node:test";
import assert from "node:assert/strict";
import * as platform from "../.test-dist/index.js";

// These existing public modules must remain reachable through the package entry.
// Importing their compiled outputs also guards the tsconfig's transitive coverage.
const publicModules = [
  "evidence-to-cash", "reliability-policy", "security-boundary", "quote-conversion",
  "customer-care-recovery", "growth-attribution", "forecast-contract", "connector-runtime",
  "mcp-projection", "mission-authority-policy", "edge-fabric", "certification-matrix",
  "continuity", "compatibility-pipeline", "vertical-profile", "titan-capsule",
  "governance/constitution", "recovery/capsule", "federation/contract", "brand-publication",
  "operations-health", "zero-cockpit", "governance/assurance", "foundry-artifact",
  "ported/titan-connect/channel-binding", "developer-portal", "directadmin-plugin",
  "workforce-manager/manager-contract", "business-engine-mapping",
];

for (const moduleName of publicModules) {
  test(`public entry preserves canonical ${moduleName} exports`, async () => {
    const canonical = await import(`../.test-dist/${moduleName}.js`);
    const names = moduleName === "certification-matrix" ? ["evaluateReleaseEligibility"]
      : moduleName === "continuity" ? ["continueTask"] : Object.keys(canonical);
    assert.ok(names.length > 0, `${moduleName} must expose a runtime contract`);
    for (const name of names) {
      assert.ok(Object.hasOwn(platform, name), `${name} missing from public entry`);
      assert.equal(platform[name], canonical[name], `${name} must reuse its canonical owner`);
    }
  });
}

test("public release eligibility rejects failed mandatory evidence", () => {
  assert.equal(platform.evaluateReleaseEligibility([
    { cell_id: "authority", mandatory: true, status: "FAIL", provenance_ref: "test:authority" },
  ]).eligible, false);
  assert.equal(platform.evaluateReleaseEligibility([
    { cell_id: "authority", mandatory: true, status: "PASS", provenance_ref: null },
  ]).eligible, false);
});

test("public continuation rejects company and authority changes", () => {
  const source = {
    company_id: "company-a", actor_id: "actor-a", task_id: "task-a", conversation_id: "conversation-a",
    run_id: "run-a", correlation_id: "correlation-a", authority_revision: 3, surface: "zero",
  };
  const destination = { company_id: "company-a", actor_id: "actor-a", authority_revision: 3, surface: "go" };
  assert.equal(platform.continueTask(source, destination).kind, "CONTINUE");
  assert.deepEqual(platform.continueTask(source, { ...destination, company_id: "company-b" }),
    { kind: "REJECT", reason: "COMPANY_MISMATCH" });
  assert.deepEqual(platform.continueTask(source, { ...destination, authority_revision: 4 }),
    { kind: "REJECT", reason: "STALE_AUTHORITY" });
});
