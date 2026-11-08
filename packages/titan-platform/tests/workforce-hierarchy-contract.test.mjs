import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const inventory = JSON.parse(fs.readFileSync(path.join(root, "src/workforce-hierarchy/pass01-inventory.json"), "utf8"));
const contractSource = fs.readFileSync(path.join(root, "src/workforce-hierarchy/contract.ts"), "utf8");

test("Pass 1 hierarchy inventory is based on Manager Merge52 and preserves company_id authority invariants", () => {
  assert.equal(inventory.packet_id, "TZ-WF-HIERARCHY-001");
  assert.equal(inventory.pass, 1);
  assert.equal(inventory.manager_base.merge, 52);
  assert.equal(inventory.invariants.company_boundary, "company_id");
  assert.equal(inventory.invariants.identity_confers_authority, false);
  assert.equal(inventory.invariants.hierarchy_confers_authority, false);
  assert.equal(inventory.invariants.delegation_confers_authority, false);
  assert.equal(inventory.invariants.execution_requires_authority_evaluation, true);
  assert.equal(inventory.production_authority_changed, false);
});

test("native hierarchy contract defines exactly Manager -> Supervisor -> Agent -> Worker", () => {
  const ordered = ["manager", "supervisor", "agent", "worker"];
  for (const tier of ordered) assert.match(contractSource, new RegExp(`\\"${tier}\\"`));
  assert.match(contractSource, /identityConfersAuthority: false/);
  assert.match(contractSource, /hierarchyConfersAuthority: false/);
  assert.match(contractSource, /delegationConfersAuthority: false/);
  assert.match(contractSource, /executionRequiresAuthorityEvaluation: true/);
  assert.match(contractSource, /existingCommandGatewayRemainsAuthoritative: true/);
});
