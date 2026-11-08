import assert from "node:assert/strict";
import test from "node:test";

import {
  createSurfaceClient,
  createSurfaceCommandIntent,
  createSurfaceProjection,
  validateSurfaceReceipt,
} from "../.test-dist/surface/index.js";

const expiresAt = "2099-09-16T05:00:00.000Z";

function commandProjection(overrides = {}) {
  return createSurfaceProjection({
    company_id: "company-01",
    surface: "command",
    actor_id: "owner-01",
    revision: "rev-42",
    issued_at: "2026-09-16T04:00:00.000Z",
    expires_at: expiresAt,
    capabilities: [
      {
        capability_id: "operations.read",
        operations: ["read"],
        mutation: false,
      },
      {
        capability_id: "decision.resolve",
        operations: ["approve", "deny"],
        mutation: true,
        requires_receipt: true,
      },
    ],
    ...overrides,
  });
}

test("creates an authority-neutral company-scoped surface projection", () => {
  const projection = commandProjection();

  assert.equal(projection.company_id, "company-01");
  assert.equal(projection.surface, "zero");
  assert.equal(projection.authority_neutral, true);
  assert.equal(projection.capabilities.length, 2);
  assert.ok(Object.isFrozen(projection));
});

test("rejects legacy tenant authority and unknown capabilities", () => {
  assert.throws(
    () => commandProjection({ tenant_company_id: "legacy-company" }),
    /tenant_company_id-not-authoritative/,
  );

  const projection = commandProjection();
  assert.throws(
    () => createSurfaceCommandIntent({
      projection,
      capability_id: "invoices.delete",
      operation: "delete",
      idempotency_key: "idem-1",
      correlation_id: "corr-1",
      payload: {},
    }),
    /surface-capability-not-authorised/,
  );
});

test("prepares command intent without granting execution authority", () => {
  const intent = createSurfaceCommandIntent({
    projection: commandProjection(),
    capability_id: "decision.resolve",
    operation: "approve",
    idempotency_key: "idem-approve-1",
    correlation_id: "corr-approve-1",
    payload: { decision_id: "decision-7" },
  });

  assert.equal(intent.company_id, "company-01");
  assert.equal(intent.transport, "titan-command-bus");
  assert.equal(intent.execution_authorised, false);
  assert.equal(intent.requires_server_acceptance, true);
  assert.equal(intent.requires_receipt, true);
});

test("fails closed when a projection is expired", () => {
  const projection = commandProjection({ expires_at: "2026-09-16T04:00:01.000Z" });
  assert.throws(
    () => createSurfaceCommandIntent({
      projection,
      now: "2026-09-16T04:00:02.000Z",
      capability_id: "decision.resolve",
      operation: "approve",
      idempotency_key: "idem-expired",
      correlation_id: "corr-expired",
      payload: {},
    }),
    /surface-projection-expired/,
  );
});

test("validates receipt company, correlation and command identity", () => {
  const intent = createSurfaceCommandIntent({
    projection: commandProjection(),
    capability_id: "decision.resolve",
    operation: "approve",
    idempotency_key: "idem-receipt",
    correlation_id: "corr-receipt",
    payload: {},
  });

  assert.throws(
    () => validateSurfaceReceipt(intent, {
      receipt_id: "receipt-1",
      command_id: intent.command_id,
      company_id: "company-02",
      correlation_id: intent.correlation_id,
      status: "accepted",
    }),
    /surface-receipt-company-mismatch/,
  );
});

test("shared client reads a projection and submits only validated intents", async () => {
  const projection = commandProjection();
  const transport = {
    async getProjection(request) {
      assert.deepEqual(request, { company_id: "company-01", surface: "zero" });
      return projection;
    },
    async submitCommand(intent) {
      return {
        receipt_id: "receipt-client-1",
        command_id: intent.command_id,
        company_id: intent.company_id,
        correlation_id: intent.correlation_id,
        status: "accepted",
      };
    },
  };
  const client = createSurfaceClient({ company_id: "company-01", surface: "command", transport });
  await client.refreshProjection();
  const receipt = await client.submit({
    capability_id: "decision.resolve",
    operation: "deny",
    idempotency_key: "idem-client-1",
    correlation_id: "corr-client-1",
    payload: { decision_id: "decision-7" },
  });

  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.authority_source, "server");
});
