import test from "node:test";
import assert from "node:assert/strict";
import { createTitanConnectorDescriptor, TITAN_CONNECTOR_CONTRACT } from "../.test-dist/index.js";

test("Titan Connect descriptor is company-scoped and authority-neutral", () => {
  const descriptor = createTitanConnectorDescriptor({
    id: "acme-crm",
    company_id: "company-a",
    provider: "acme",
    capabilities: [{ id: "customers.read", operation: "read" }],
    permissions: [{ capability_id: "customers.read", granted: true }],
    health: { status: "healthy", checked_at: 123 },
    credential_ref: "vault://credential/1",
  });
  assert.equal(descriptor.company_id, "company-a");
  assert.equal(descriptor.health.status, "healthy");
  assert.equal(descriptor.credential_ref, "vault://credential/1");
  assert.equal(TITAN_CONNECTOR_CONTRACT.execution_authority, false);
  assert.equal(TITAN_CONNECTOR_CONTRACT.activation_confers_authority, false);
});

test("Titan Connect rejects blank company scope", () => {
  assert.throws(() => createTitanConnectorDescriptor({
    id: "acme-crm", company_id: " ", provider: "acme",
  }), /company_id-required/);
});

test("Connector permissions describe access; they do not become execution authority", () => {
  const descriptor = createTitanConnectorDescriptor({
    id: "acme", company_id: "company-a", provider: "acme",
    capabilities: [{ id: "jobs.execute", operation: "execute" }],
    permissions: [{ capability_id: "jobs.execute", granted: true }],
  });
  assert.equal(descriptor.permissions[0].granted, true);
  assert.equal(TITAN_CONNECTOR_CONTRACT.registration_confers_authority, false);
  assert.equal(TITAN_CONNECTOR_CONTRACT.execution_authority, false);
});
