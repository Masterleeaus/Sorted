import assert from "node:assert/strict";
import { classifyDeterministicIntent, listDeterministicIntentRules } from "../interaction-engine/index.mjs";

const ctx = { company_id:"company-a", surface:"zero", actor_id:"u1", operation_id:"op12", request_id:"req12" };

const booking = classifyDeterministicIntent({ context:ctx, text:"Please book a cleaner for tomorrow" });
assert.equal(booking.resolved, true);
assert.equal(booking.intent.name, "booking.create");
assert.equal(booking.interpretation.capability_requirements[0].capability, "booking.create");
assert.equal(booking.escalation.requested, false);
assert.equal(booking.escalation.classifier_invokes_model, false);
assert.equal(booking.execution_authority, false);

const quote = classifyDeterministicIntent({ context:ctx, text:"I need a quote for a bond clean" });
assert.equal(quote.intent.name, "quote.request");
assert.equal(quote.interpretation.capability_requirements[0].offline_preferred, true);

const browser = classifyDeterministicIntent({ context:ctx, text:"Fill this form with these details" });
assert.equal(browser.intent.name, "browser.form_fill");

const unknown = classifyDeterministicIntent({ context:ctx, text:"blue ideas sleep quickly" });
assert.equal(unknown.resolved, false);
assert.equal(unknown.intent.name, "unknown");
assert.equal(unknown.escalation.requested, true);
assert.equal(unknown.escalation.reason, "no-deterministic-match");

const ambiguous = classifyDeterministicIntent({ context:ctx, text:"book and cancel my booking" }, { ambiguity_margin:0.2 });
assert.equal(ambiguous.resolved, false);
assert.equal(ambiguous.ambiguity_detected, true);
assert.equal(ambiguous.interpretation.needs_clarification, true);
assert.equal(ambiguous.escalation.reason, "deterministic-ambiguity");

assert.throws(() => classifyDeterministicIntent({ company_id:"company-a", tenant_id:"company-a", surface:"zero", text:"book a cleaner" }), /authority boundary|legacy tenant|company_id/i);
assert.throws(() => classifyDeterministicIntent({ context:{company_id:"company-b",surface:"zero"}, company_id:"company-a", text:"book a cleaner" }), /company-mismatch/);
assert.ok(listDeterministicIntentRules().length >= 15);
console.log("Step 12 deterministic intent classifier tests PASS");
