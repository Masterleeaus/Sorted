import test from "node:test";
import assert from "node:assert/strict";
import {
  createDeveloperAccess,
  recordDeveloperDiagnostic,
  assertDeveloperAccessCurrent,
  assertDiagnosticCompany,
} from "../.test-dist/developer-portal.js";

const access = createDeveloperAccess({
  company_id: "co-1",
  actor_id: "dev-1",
  scopes: ["diagnostic"],
  expires_at: "2099-12-01T00:00:00Z",
});

test("creates scoped authority-neutral access and redacted diagnostic", () => {
  const d = recordDeveloperDiagnostic(
    {
      diagnostic_id: "d1",
      company_id: "co-1",
      scope: "diagnostic",
      subject_ref: "service:1",
      status: "observed",
      summary: "healthy",
      redacted_details: ["token=[REDACTED]"],
      created_at: "2026-02-01T00:00:00Z",
    },
    access,
  );
  assert.equal(access.authority_granted, false);
  assert.equal("actor_id" in d, false);
  assert.equal(assertDiagnosticCompany(d, "co-1"), true);
});

test("rejects cross-company and out-of-scope diagnostics", () => {
  assert.throws(
    () =>
      recordDeveloperDiagnostic(
        {
          diagnostic_id: "d",
          company_id: "co-2",
          scope: "diagnostic",
          subject_ref: "x",
          status: "unknown",
          summary: "x",
          redacted_details: [],
        },
        access,
      ),
    /company-mismatch/,
  );
  assert.throws(
    () =>
      recordDeveloperDiagnostic(
        {
          diagnostic_id: "d",
          company_id: "co-1",
          scope: "read",
          subject_ref: "x",
          status: "unknown",
          summary: "x",
          redacted_details: [],
        },
        access,
      ),
    /scope-denied/,
  );
});

test("rejects invalid or already-expired access metadata", () => {
  assert.throws(
    () =>
      createDeveloperAccess({
        company_id: "co-1",
        actor_id: "dev",
        scopes: ["read"],
        expires_at: "bad",
      }),
    /expires_at-invalid/,
  );
  assert.throws(
    () =>
      createDeveloperAccess({
        company_id: "co-1",
        actor_id: "dev",
        scopes: ["read"],
        expires_at: "2000-01-01T00:00:00Z",
      }),
    /expires_at-expired/,
  );
});

test("expired access cannot be reused for diagnostics", () => {
  assert.equal(assertDeveloperAccessCurrent(access, "2099-11-30T23:59:59Z"), true);
  assert.throws(
    () => assertDeveloperAccessCurrent(access, "2099-12-01T00:00:00Z"),
    /developer-access-expired/,
  );
});

test("sanitizes MCP schemas and blocks non-read inspector execution", async () => {
  const mod = await import("../.test-dist/developer-portal.js");
  const server = mod.inspectDeveloperMcpServer({
    server_id: "mcp-1",
    state: "CONNECTED",
    protocol_version: "2025-06-18",
    version: "1.2.3",
    tools: [
      {
        name: "repository_status",
        description: "Read status",
        classification: "READ",
        input_schema: { type: "object", properties: { path: { type: "string", default: "/secret" } }, token: "abc" },
      },
      {
        name: "repository_write",
        description: "Write file",
        classification: "WRITE",
        input_schema: { type: "object", example: { token: "hidden" } },
      },
      {
        name: "mystery",
        classification: "something-else",
      },
    ],
  });
  assert.equal(server.authority_granted, false);
  assert.equal(server.tools[0].execution_available, true);
  assert.equal(server.tools[1].execution_available, false);
  assert.equal(server.tools[1].blocked_reason, "governed-execution-required");
  assert.equal(server.tools[2].classification, "UNKNOWN");
  assert.equal(server.tools[2].blocked_reason, "classification-unknown");
  assert.equal("token" in server.tools[0].sanitized_input_schema, false);
  assert.equal(server.tools[0].sanitized_input_schema.properties.path.default, undefined);
});

test("capability inspector is authority-neutral and unknown classes fail closed", async () => {
  const mod = await import("../.test-dist/developer-portal.js");
  const capability = mod.inspectDeveloperCapability({
    capability_id: "crm.customer.read",
    owner: "crm",
    provider: "native-fsm",
    state: "CONNECTED",
    operation_class: "READ",
  });
  assert.equal(capability.authority_granted, false);
  assert.equal(capability.operation_class, "READ");

  const unknown = mod.inspectDeveloperCapability({
    capability_id: "x",
    owner: "y",
    state: "DEGRADED",
    operation_class: "surprise",
    reason: "unclassified",
  });
  assert.equal(unknown.operation_class, "UNKNOWN");
});

test("deployment inspector requires exact source identity and never grants deploy authority", async () => {
  const mod = await import("../.test-dist/developer-portal.js");
  const deployment = mod.inspectDeveloperDeployment({
    deployment_id: "dep-1",
    source_sha: "abcdef1234567",
    environment: "staging",
    state: "DEPLOYED",
    verified: true,
    verification_ref: "receipt-1",
    rollback_ref: "rollback-1",
  });
  assert.equal(deployment.authority_granted, false);
  assert.equal(deployment.verified, true);
  assert.throws(
    () =>
      mod.inspectDeveloperDeployment({
        deployment_id: "dep-2",
        source_sha: "not-a-sha",
        environment: "prod",
      }),
    /source_sha-invalid/,
  );
});

