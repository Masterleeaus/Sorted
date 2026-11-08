import test from "node:test";
import assert from "node:assert/strict";
import { compileContractInventory } from "../.test-dist/distribution-contract-compiler.js";

const source = (kind, document, source_ref = "api.yaml") => ({
  kind, document, source_ref, source_revision: "sha256:source-revision",
});

test("compiles OpenAPI operations and schemas into deterministic unmapped inventory", async () => {
  const input = source("OPENAPI", {
    openapi: "3.1.0",
    paths: {
      "/jobs": { post: { operationId: "createJob" } },
      "/jobs/{id}": { get: { operationId: "getJob" } },
    },
    components: { schemas: { Job: { type: "object" } } },
  });
  const first = await compileContractInventory([input]);
  const second = await compileContractInventory([input]);
  assert.equal(first.inventory_hash, second.inventory_hash);
  assert.deepEqual(first.items.map((item) => item.local_id), ["createJob", "getJob", "schema:Job"]);
  assert.ok(first.items.every((item) => item.canonical_capability_id === null && item.status === "MAPPING_REQUIRED"));
  assert.match(first.inventory_hash, /^sha256:[a-f0-9]{64}$/);
});

test("compiles webhook operations, standalone JSON Schema and MCP tools", async () => {
  const inventory = await compileContractInventory([
    source("WEBHOOK", { webhooks: { invoicePaid: { post: { operationId: "invoicePaid" } } } }, "hooks.yaml"),
    source("JSON_SCHEMA", { $id: "urn:titan:customer", $defs: { Address: { type: "object" } } }, "customer.json"),
    source("MCP", { tools: [{ name: "searchJobs" }, { name: "createJob" }] }, "mcp.json"),
  ]);
  assert.deepEqual(inventory.items.map((item) => item.operation), ["JSON_SCHEMA", "MCP_TOOL", "MCP_TOOL", "POST invoicePaid"]);
});

test("fails closed for malformed contracts and duplicate source-local identities", async () => {
  await assert.rejects(compileContractInventory([]), /contract-source-required/);
  await assert.rejects(compileContractInventory([source("OPENAPI", { openapi: "2.0", paths: {} })]), /openapi-3-required/);
  await assert.rejects(compileContractInventory([source("MCP", { tools: [{ name: "same" }, { name: "same" }] })]), /contract-item-id-duplicate/);
});

test("rejects unknown source kinds, malformed MCP tools, and missing provenance for empty inventories", async () => {
  await assert.rejects(
    compileContractInventory([source("UNTRUSTED_KIND", { tools: [{ name: "candidate" }] })]),
    /contract-source-kind-invalid/,
  );
  await assert.rejects(
    compileContractInventory([source("MCP", { tools: "not-an-array" })]),
    /mcp-tools-array-required/,
  );
  await assert.rejects(
    compileContractInventory([{ kind: "MCP", document: { tools: [] }, source_ref: " ", source_revision: "rev-1" }]),
    /source_ref-required/,
  );
  await assert.rejects(
    compileContractInventory([{ kind: "MCP", document: { tools: [] }, source_ref: "mcp.json", source_revision: " " }]),
    /source_revision-required/,
  );

  const empty = await compileContractInventory([source("MCP", { tools: [] })]);
  assert.deepEqual(empty.items, []);
});

test("uses unambiguous tuple identities and ordering for colon-bearing references and IDs", async () => {
  const sourceAndItemColon = source("MCP", { tools: [{ name: "c" }] }, "a:b");
  const sourceColon = source("MCP", { tools: [{ name: "b:c" }] }, "a");
  const first = await compileContractInventory([sourceAndItemColon, sourceColon]);
  const reversed = await compileContractInventory([sourceColon, sourceAndItemColon]);

  assert.equal(first.inventory_hash, reversed.inventory_hash);
  assert.deepEqual(first.items.map(({ source_ref, local_id }) => [source_ref, local_id]), [
    ["a", "b:c"],
    ["a:b", "c"],
  ]);
});
