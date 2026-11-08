import test from "node:test";
import assert from "node:assert/strict";

const ui = await import("../src/ported/titan-runtime/interface-runtime/zero-generated-ui.ts");
const interaction = await import("../src/ported/titan-runtime/interaction-engine/zero-interaction.ts");

test("Zero generated UI is bounded and cannot directly execute", () => {
  const card = ui.createZeroGeneratedUI({ company_id:"company-a", surface:"zero", component_id:"decision-1", kind:"decision", props:{ title:"Review staffing", html:"<script>bad()</script>" }, actions:[{ intent:"staffing.reassign", label:"Approve", authority_mode:"approve_execute", params:{ job_id:"j1" } }] });
  assert.equal(card.executable_frontend, false);
  assert.equal(card.authority_granted, false);
  assert.equal(card.props.html, undefined);
  assert.equal(card.actions[0].downstream_authorization_required, true);
});

test("Zero generated UI rejects arbitrary components and direct effects", () => {
  assert.throws(() => ui.createZeroGeneratedUI({ company_id:"company-a", component_id:"x", kind:"javascript" }), /kind-not-allowed/);
  assert.throws(() => ui.createZeroGeneratedUI({ company_id:"company-a", component_id:"x", kind:"job", actions:[{ intent:"job.cancel", execute:true }] }), /cannot-execute/);
});

test("Zero interaction is multimodal but authority neutral", () => {
  for (const modality of ["text","voice","image","camera","attachment","generated_ui_action"]) {
    const event = interaction.createZeroInteraction({ company_id:"company-a", interaction_id:`i-${modality}`, conversation_id:"c1", modality, text:"status" });
    assert.equal(event.surface, "zero");
    assert.equal(event.authority_granted, false);
    assert.equal(event.execution_authority, false);
  }
});

test("Zero interaction rejects cross-surface and legacy tenant authority", () => {
  assert.throws(() => interaction.createZeroInteraction({ company_id:"company-a", surface:"go", interaction_id:"i", conversation_id:"c" }), /surface-required/);
  assert.throws(() => interaction.createZeroInteraction({ company_id:"company-a", tenant_id:"legacy", interaction_id:"i", conversation_id:"c" }), /legacy/i);
});
