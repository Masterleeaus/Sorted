import test from "node:test";
import assert from "node:assert/strict";
import { VerticalPackStore, createVerticalPack } from "../.test-dist/vertical-pack.js";

const pack = (overrides = {}) => createVerticalPack({ pack_id: "cleaning", version: "1.0.0", label: "Cleaning", company_id: "co-1", standards_pack_id: "cleaning-standards", ...overrides });

test("stages and installs a company-bound vertical pack", () => {
  const store = new VerticalPackStore("co-1", ["evidence-1"]);
  assert.equal(store.preview(pack()).state, "staged"); assert.equal(store.packs.length, 0);
  assert.equal(store.install(pack()).state, "installed"); assert.equal(store.packs[0].company_id, "co-1");
  assert.equal(store.hasPermanentEvidence("evidence-1"), true);
});

test("upgrades, disables, and retires without deleting promoted evidence", () => {
  const store = new VerticalPackStore("co-1", ["evidence-1"]); store.install(pack({ promoted_evidence_refs: ["evidence-1"] }));
  assert.equal(store.upgrade(pack({ version: "2.0.0" })).version, "2.0.0");
  assert.equal(store.disable("cleaning").state, "disabled"); assert.equal(store.retire("cleaning").state, "retired");
  assert.equal(store.hasPermanentEvidence("evidence-1"), true);
});

test("rejects cross-company packs and invalid upgrade targets", () => {
  const store = new VerticalPackStore("co-1");
  assert.throws(() => store.install(pack({ company_id: "co-2" })), /company-context/);
  assert.throws(() => store.upgrade(pack({ pack_id: "missing", version: "2.0.0" })), /upgrade-target/);
});

