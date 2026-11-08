import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkforceKnowledgeAuthorityPacket,
  evaluateWorkforceKnowledgeUse,
  buildWorkforceKnowledgeUseReceipt,
} from "../.test-dist/ported/titan-workforce/knowledge/workforce-knowledge-authority-runtime.js";

const publicSource = {
  knowledge_id: "public-1",
  scope: "SHARED_PUBLIC",
  source_identity: "public-regulator",
  provenance_refs: ["evidence-1"],
  version: "2026-09",
  freshness: "FRESH",
  contradiction_state: "NONE",
};

const privateSource = {
  knowledge_id: "private-1",
  scope: "COMPANY_PRIVATE",
  company_id: "company-a",
  source_identity: "company-manual",
  provenance_refs: ["evidence-2"],
  version: "7",
  freshness: "FRESH",
  contradiction_state: "NONE",
};

test("Knowledge Authority separates shared-public and company-private knowledge", () => {
  const packet = buildWorkforceKnowledgeAuthorityPacket({ company_id: "company-a", knowledge: [publicSource, privateSource] });
  assert.equal(packet.readiness.shared_public_count, 1);
  assert.equal(packet.readiness.company_private_count, 1);
  assert.equal(packet.knowledge.find(x => x.knowledge_id === "public-1").company_id, null);
  assert.equal(packet.knowledge.find(x => x.knowledge_id === "private-1").company_id, "company-a");
  assert.equal(packet.policy.company_private_never_shared_across_companies, true);
});

test("Knowledge Authority requires source identity and provenance", () => {
  const packet = buildWorkforceKnowledgeAuthorityPacket({
    company_id: "company-a",
    knowledge: [{ ...publicSource, source_identity: "", provenance_refs: [] }],
  });
  assert.equal(packet.readiness.ready, false);
  assert.ok(packet.readiness.blockers.includes("public-1:source-identity-required"));
  assert.ok(packet.readiness.blockers.includes("public-1:provenance-required"));
});

test("Knowledge Authority rejects cross-company and legacy tenant knowledge", () => {
  assert.throws(
    () => buildWorkforceKnowledgeAuthorityPacket({ company_id: "company-a", knowledge: [{ ...privateSource, company_id: "company-b" }] }),
    /cross-company-source/
  );
  assert.throws(
    () => buildWorkforceKnowledgeAuthorityPacket({ company_id: "company-a", tenant_id: "legacy", knowledge: [publicSource] }),
    /legacy-company-boundary/
  );
});

test("Knowledge use is deterministic reasoning input and never execution authority", () => {
  const packet = buildWorkforceKnowledgeAuthorityPacket({ company_id: "company-a", knowledge: [publicSource, privateSource] });
  const decision = evaluateWorkforceKnowledgeUse(packet, { company_id: "company-a", knowledge_ids: ["private-1", "public-1"] });
  assert.equal(decision.decision, "ALLOW_FOR_REASONING");
  assert.equal(decision.requires_independent_authority_decision, true);
  assert.equal(decision.knowledge_is_not_authority, true);
  assert.equal(decision.execution_permitted, false);
  assert.equal(decision.authority_granted, false);

  const receipt = buildWorkforceKnowledgeUseReceipt(packet, decision, { receipt_id: "receipt-1" });
  assert.equal(receipt.knowledge_is_not_authority, true);
  assert.equal(receipt.receipt_is_not_execution_authority, true);
  assert.equal(receipt.execution_permitted, false);
  assert.deepEqual(receipt.provenance_refs.sort(), ["evidence-1", "evidence-2"]);
});
