import test from "node:test";
import assert from "node:assert/strict";
import { SystemConfigurationStore, buildSystemGraph, createSystemComponent, exportSystemConfiguration } from "../.test-dist/system-configuration.js";

const component = (id, overrides = {}) => createSystemComponent({ component_id: id, runtime_id: `runtime.${id}`, version: "1.0.0", scope: "company", configuration_schema: `schema.${id}.v1`, provenance: "canonical-runtime", ...overrides });

test("builds a canonical graph with dependency and consumer edges", () => {
  const graph = buildSystemGraph("co-1", [component("command-bus", { consumer_ids: ["decision"] }), component("decision", { dependency_ids: ["command-bus"], capability_ids: ["decision.configure"] })]);
  assert.equal(graph.authority, "configuration-and-diagnostics-only");
  assert.equal(graph.edges.length, 2);
  assert.throws(() => buildSystemGraph("co-1", [component("bad", { dependency_ids: ["missing"] })]), /unknown-system-dependency/);
});

test("configuration lifecycle previews, applies, and rolls back a company-bound draft", () => {
  const store = new SystemConfigurationStore("co-1", "decision", { threshold: 3 });
  store.stage("co-1", { threshold: 5 });
  assert.equal(store.preview().revision, 1); assert.equal(store.current.revision, 0);
  store.apply(); assert.equal(store.current.values.threshold, 5); assert.equal(store.rollback().values.threshold, 3);
  assert.throws(() => store.stage("co-2", { threshold: 9 }), /company-context/);
});

test("export accepts secret references but rejects raw secrets", () => {
  const store = new SystemConfigurationStore("co-1", "channels", { api_secret: { $ref: "secret://channels/api" }, endpoint: "local" });
  store.stage("co-1", store.current.values); const exported = exportSystemConfiguration(store.preview());
  assert.deepEqual(exported.values.api_secret, { $ref: "secret://channels/api" });
  const unsafe = new SystemConfigurationStore("co-1", "channels");
  unsafe.stage("co-1", { api_token: "plaintext" });
  assert.throws(() => unsafe.validate(), /raw-secret/);
});

