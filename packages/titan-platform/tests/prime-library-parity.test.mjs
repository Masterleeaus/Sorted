import test from "node:test";
import assert from "node:assert/strict";

import { createPrimeEnvelope, runtimeDescriptor } from "../.test-dist/ported/titan-runtime/prime/index.js";

const base = {
  company_id: "company-a",
  mission_id: "mission-1",
  objective: { kind: "inspect" },
  evidence_refs: ["evidence-b", "evidence-a", "evidence-b"],
};

test("Prime normalizes company scope and deterministic evidence without granting authority", () => {
  const mission = createPrimeEnvelope(base);
  assert.equal(mission.company_id, "company-a");
  assert.deepEqual(mission.evidence_refs, ["evidence-a", "evidence-b"]);
  assert.equal(mission.authority_neutral, true);
  assert.equal(mission.execution_authority, false);
  assert.equal(mission.mission_is_authority, false);
  assert.equal(mission.authority_conferred_by_activation, false);
  assert.equal(mission.command_bus_required, true);
  assert.equal(mission.governance_required, true);
  assert.equal(mission.authority_check_required, true);
});

test("Prime rejects missing or legacy tenant scope", () => {
  assert.throws(() => createPrimeEnvelope({ ...base, company_id: " " }), /company_id is required/);
  assert.throws(
    () => createPrimeEnvelope({ ...base, tenant_id: "legacy" }),
    /tenant_id is not an authority boundary/
  );
  assert.throws(
    () => createPrimeEnvelope({ ...base, objective: { tenant_company_id: "legacy" } }),
    /tenant_company_id is not an authority boundary/
  );
});

test("Prime requires a bounded mission identity and objective", () => {
  assert.throws(() => createPrimeEnvelope({ ...base, mission_id: "" }), /mission_id is required/);
  assert.throws(() => createPrimeEnvelope({ ...base, objective: null }), /objective must be an object/);
});

test("Prime runtime descriptor cannot bypass authority or governance systems", () => {
  assert.equal(runtimeDescriptor.execution_authority, false);
  assert.equal(runtimeDescriptor.authority_conferred_by_activation, false);
  assert.equal(runtimeDescriptor.command_bus_required, true);
  assert.equal(runtimeDescriptor.governance_required, true);
  assert.equal(runtimeDescriptor.authority_check_required, true);
});
