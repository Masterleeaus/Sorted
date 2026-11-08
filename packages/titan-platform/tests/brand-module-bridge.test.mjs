import test from "node:test";
import assert from "node:assert/strict";
import { createInterfaceContext } from "../.test-dist/ported/titan-runtime/interface-runtime/context.js";
import { createBrandActionBinding } from "../.test-dist/brand-publication.js";
import { DirectAdminCockpitSession } from "../.test-dist/directadmin-cockpit.js";

const brand = await import("../.test-dist/brand-publication.js");
const { BRAND_MODULE_IDS, createBrandModulePresentation, submitBrandStudioActionIntent } = brand;

const binding = createBrandActionBinding({
  schema: "titan.brand-action-binding/v1",
  action_id: "booking.request",
  capability_id: "booking",
  context_schema: "titan.interface-context.v2",
  required_context: ["company_id", "user_id", "product_surface", "domain", "capabilities"],
  entitlement: "web.booking",
  risk_class: "consequential",
  offline_behavior: "queue_for_revalidation",
  public_behavior: "guest_scoped",
  fallback: "show_contact_details",
  accessibility: { keyboard: true, screen_reader_label: "Request booking", reduced_motion: true },
  evidence_requirements: ["booking-request-receipt"],
  authority_granted: false,
});

function context(capabilities = ["booking"], product_surface = "hub") {
  return createInterfaceContext({
    company_id: "co-1",
    user_id: "actor-1",
    product_surface,
    domain: "web",
    capabilities,
    trace_id: "trace-1",
    correlation_id: "corr-1",
  });
}

test("declares every requested Titan module family against the shared Interface Runtime context schema", () => {
  assert.equal(typeof createBrandModulePresentation, "function");
  assert.deepEqual(BRAND_MODULE_IDS, [
    "titan/assistant", "titan/booking", "titan/quote", "titan/customer-portal", "titan/project",
    "titan/jobs", "titan/evidence", "titan/catalogue", "titan/cart", "titan/checkout",
    "titan/payment", "titan/messages", "titan/reviews", "titan/assets", "titan/workforce-status",
    "titan/form", "titan/approval", "titan/progress",
  ]);
  for (const module_id of BRAND_MODULE_IDS) {
    const result = createBrandModulePresentation({ module_id, presentation_id: `presentation:${module_id}`, company_id: "co-1", context: context(["fixture.capability"]), capability_id: "fixture.capability" });
    assert.equal(result.schema, "titan.brand-module-presentation/v1");
    assert.equal(result.presentation.schema, "titan.interface.presentation-tree/v1");
    assert.equal(result.presentation.authority_granted, false);
    assert.equal(result.presentation.nodes[0].type, module_id);
    assert.equal(result.visual_contribution.company_id, "co-1");
    assert.deepEqual(result.visual_contribution.surfaces, ["hub"]);
    assert.equal(result.visual_contribution.business_authority, false);
    assert.equal(result.visual_contribution.authorizes_actions, false);
    assert.equal(result.visual_contribution.treatment.business_meaning_unchanged, true);
    assert.equal(result.interaction_intent.schema_version, "1.0");
    assert.equal(result.interaction_intent.execution_authority, false);
  }
});

test("preserves the canonical Zero, Go, and Hub surface in both interface and interaction projections", () => {
  for (const surface of ["zero", "go", "hub"]) {
    const result = createBrandModulePresentation({
      module_id: "titan/booking", presentation_id: `surface:${surface}`, company_id: "co-1",
      context: context(["booking"], surface), capability_id: "booking",
    });
    assert.equal(result.presentation.surface, surface);
    assert.equal(result.interaction_intent.surface, surface);
    assert.deepEqual(result.visual_contribution.surfaces, [surface]);
    assert.equal(result.presentation.nodes[0].props.state, "available");
  }
});

test("emits a canonical Interface Runtime receipt scoped only to the module presentation projection", () => {
  const result = createBrandModulePresentation({
    module_id: "titan/booking", presentation_id: "booking-presentation-receipt", company_id: "co-1", context: context(), capability_id: "booking",
  });
  assert.equal(result.interface_receipt.receipt_kind, "interface");
  assert.equal(result.interface_receipt.company_id, "co-1");
  assert.equal(result.interface_receipt.receipt_id, "interface:booking-presentation-receipt");
  assert.equal(result.interface_receipt.presentation_id, "booking-presentation-receipt");
  assert.equal(result.interface_receipt.receipt_scope, "presentation_projection");
  assert.equal(result.interface_receipt.authority_neutral, true);
  assert.equal(result.interface_receipt.execution_authority, false);
  assert.equal(result.interface_receipt.receipt_scope === "business_action", false);
});

test("projects only company-matched capability context and keeps actions declarative", () => {
  const result = createBrandModulePresentation({
    module_id: "titan/booking", presentation_id: "booking-presentation-1", company_id: "co-1", context: context(), capability_id: "booking",
    data_refs: [{ company_id: "co-1", ref: "booking-list:opaque" }], evidence_refs: [{ company_id: "co-1", ref: "receipt:opaque" }], action_bindings: [binding],
  });
  const node = result.presentation.nodes[0];
  assert.equal(result.company_id, "co-1");
  assert.equal(node.props.state, "available");
  assert.deepEqual(node.props.data_refs, [{ company_id: "co-1", ref: "booking-list:opaque" }]);
  assert.deepEqual(node.props.action_ids, ["booking.request"]);
  assert.equal(node.props.authority_granted, false);
  assert.equal(result.interaction_intent.actions[0].intent, "booking.request");
  assert.equal(result.interaction_intent.actions[0].governed_intent, true);
  assert.equal(result.interaction_intent.actions[0].authority_granted, false);
  assert.throws(() => createBrandModulePresentation({ module_id: "titan/booking", presentation_id: "p-cross-company", company_id: "co-2", context: context(), capability_id: "booking" }), /company-mismatch/);
  assert.throws(() => createBrandModulePresentation({ module_id: "titan/booking", presentation_id: "p-wrong-capability", company_id: "co-1", context: context(), capability_id: "quote", action_bindings: [binding] }), /action-capability-mismatch/);
  assert.throws(() => createBrandModulePresentation({ module_id: "titan/booking", presentation_id: "p-invalid-capability", company_id: "co-1", context: context(), capability_id: "booking\n" }), /capability-invalid/);
  assert.throws(() => createBrandModulePresentation({ module_id: "titan/booking", presentation_id: "p-too-many-actions", company_id: "co-1", context: context(), capability_id: "booking", action_bindings: Array(33).fill(binding) }), /action-limit/);
  assert.throws(() => createBrandModulePresentation({ module_id: "titan/unknown", presentation_id: "p-unknown-module", company_id: "co-1", context: context(), capability_id: "booking" }), /module-unsupported/);
  const incomplete = createBrandActionBinding({ ...binding, action_id: "booking.special", required_context: ["company_id", "server_only_context"] });
  assert.throws(() => createBrandModulePresentation({ module_id: "titan/booking", presentation_id: "p-incomplete-context", company_id: "co-1", context: context(), capability_id: "booking", action_bindings: [incomplete] }), /context-incomplete/);
  const missingWorkspace = createBrandActionBinding({ ...binding, action_id: "booking.workspace", required_context: ["company_id", "workspace_id"] });
  assert.throws(() => createBrandModulePresentation({ module_id: "titan/booking", presentation_id: "p-null-workspace", company_id: "co-1", context: context(), capability_id: "booking", action_bindings: [missingWorkspace] }), /context-incomplete/);
  assert.throws(() => createBrandModulePresentation({ module_id: "titan/booking", presentation_id: "p-cross-ref", company_id: "co-1", context: context(), capability_id: "booking", data_refs: [{ company_id: "co-2", ref: "booking-list:opaque" }] }), /reference-company-mismatch/);
});

test("degrades unavailable capability to a data-free, action-free fallback presentation", () => {
  const result = createBrandModulePresentation({
    module_id: "titan/booking", presentation_id: "booking-presentation-unavailable", company_id: "co-1", context: context([]), capability_id: "booking",
    data_refs: [{ company_id: "co-1", ref: "booking-list:opaque" }], action_bindings: [binding],
  });
  const props = result.presentation.nodes[0].props;
  assert.equal(props.state, "unavailable");
  assert.equal(props.fallback, "contact_owner");
  assert.deepEqual(props.data_refs, []);
  assert.deepEqual(props.action_ids, []);
  assert.deepEqual(result.interaction_intent.actions, []);
});

test("submits authenticated Brand Studio actions through the canonical DirectAdmin intent boundary", async () => {
  const authenticatedBinding = createBrandActionBinding({ ...binding, public_behavior: "authenticated_only" });
  const calls = [];
  const serverResult = { accepted: true, status: "pending-canonical-verification" };
  const result = await submitBrandStudioActionIntent({
    session: { intent: async (...args) => { calls.push(args); return serverResult; } },
    module_id: "titan/booking", binding: authenticatedBinding, context: context(),
    operation_id: "operation-1", correlation_id: "correlation-1", payload: { date: "2026-10-03" },
  });
  assert.equal(result, serverResult);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "titan_web");
  assert.deepEqual(calls[0][1], {
    company_id: "co-1", actor_id: "actor-1", capability_id: "booking", operation_id: "operation-1",
    correlation_id: "correlation-1", input: { module_id: "titan/booking", action_id: "booking.request", payload: { date: "2026-10-03" } },
  });
});

test("does not route guest, unavailable, unauthorized, or secret-bearing actions to DirectAdmin", async () => {
  const calls = [];
  const session = { intent: async (...args) => { calls.push(args); return {}; } };
  const args = { session, module_id: "titan/booking", binding, context: context(), operation_id: "op", correlation_id: "corr", payload: {} };
  await assert.rejects(submitBrandStudioActionIntent(args), /authenticated-only/);
  await assert.rejects(submitBrandStudioActionIntent({ ...args, binding: createBrandActionBinding({ ...binding, public_behavior: "unavailable" }) }), /authenticated-only/);
  await assert.rejects(submitBrandStudioActionIntent({ ...args, binding: createBrandActionBinding({ ...binding, public_behavior: "authenticated_only" }), context: context([]) }), /capability-unavailable/);
  await assert.rejects(submitBrandStudioActionIntent({ ...args, binding: createBrandActionBinding({ ...binding, public_behavior: "authenticated_only" }), payload: { api_token: "do-not-forward" } }), /payload-sensitive/);
  assert.equal(calls.length, 0);
});

test("binds Brand Studio cockpit intents to the live shared SDK actor and company context", async () => {
  const intentRequests = [];
  const contextReply = {
    schema: "titan.directadmin.session/v1", actor_id: "actor-1", company_id: "co-1", company_ids: ["co-1"],
    context_revision: "revision-1", session_revision: 7, da_role: "user", authority: "not-carried",
    expires_at: Date.now() + 60_000,
  };
  const session = new DirectAdminCockpitSession(() => "A".repeat(43), async (path, init) => {
    if (path === "/v1/directadmin/bootstrap") return new Response(JSON.stringify({ csrf_token: "B".repeat(43) }), { status: 200 });
    if (path === "/v1/directadmin/context") return new Response(JSON.stringify(contextReply), { status: 200 });
    intentRequests.push({ path, body: init.body });
    return new Response(JSON.stringify({ status: "REQUESTED", receipt_id: "receipt-1" }), { status: 202 });
  }, undefined);
  try {
    await session.connect();
    const authenticatedBinding = createBrandActionBinding({ ...binding, public_behavior: "authenticated_only" });
    const result = await submitBrandStudioActionIntent({
      session, module_id: "titan/booking", binding: authenticatedBinding, context: context(),
      operation_id: "operation-2", correlation_id: "correlation-2", payload: { date: "2026-10-03" },
    });
    assert.deepEqual(result, { status: "REQUESTED", receipt_id: "receipt-1" });
    assert.equal(intentRequests.length, 1);
    assert.equal(intentRequests[0].path, "/v1/directadmin/titan_web/intents");
    const wireIntent = JSON.parse(intentRequests[0].body);
    assert.equal(wireIntent.company_id, "co-1");
    assert.equal(wireIntent.actor_id, "actor-1");
    assert.match(wireIntent.context_revision, /^ctx1_/);

    await assert.rejects(submitBrandStudioActionIntent({
      session, module_id: "titan/booking", binding: authenticatedBinding,
      context: createInterfaceContext({ company_id: "co-1", user_id: "forged-actor", product_surface: "hub", domain: "web", capabilities: ["booking"], trace_id: "trace-2", correlation_id: "corr-2" }),
      operation_id: "operation-3", correlation_id: "correlation-3", payload: {},
    }), /context-mismatch/);
    assert.equal(intentRequests.length, 1);
  } finally {
    session.dispose();
  }
});

