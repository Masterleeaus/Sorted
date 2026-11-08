import test from "node:test";
import assert from "node:assert/strict";
import { buildIntelligenceAvailabilityProjection, selectIntelligenceAvailabilityRoute } from "../.test-dist/intelligence-core.js";

const provider = (overrides = {}) => ({ id: "local", company_id: "co-1", locality: "device", capabilities: ["chat"], external: false, titanFunded: false, metered: false, enabled: true, ...overrides });
const model = (overrides = {}) => ({ id: "model-1", providerId: "local", company_id: "co-1", capabilities: ["chat"], enabled: true, ...overrides });

test("projects only company-scoped providers and models with availability metadata", () => {
  const projection = buildIntelligenceAvailabilityProjection({ company_id: "co-1", providers: [provider(), provider({ id: "other", company_id: "co-2" })], models: [model(), model({ id: "foreign", company_id: "co-2" })] });
  assert.equal(projection.schema, "titan.intelligence.availability.v1");
  assert.deepEqual(projection.providers.map((item) => item.provider.id), ["local"]);
  assert.equal(projection.models[0].available, true);
  assert.equal(projection.authorityGranted, false);
});

test("route selection fails closed for unavailable or disallowed egress", () => {
  const projection = buildIntelligenceAvailabilityProjection({ company_id: "co-1", providers: [provider({ id: "remote", locality: "byo", external: true })], models: [model({ providerId: "remote" })] });
  assert.throws(() => selectIntelligenceAvailabilityRoute({ company_id: "co-1", capability: "chat", privacy: "restricted" }, projection), /no-available/);
  const route = selectIntelligenceAvailabilityRoute({ company_id: "co-1", capability: "chat", privacy: "internal", allowExternal: true }, projection);
  assert.equal(route.provider.id, "remote");
  assert.equal(route.authorityGranted, false);
});

test("rejects cross-company route requests and degraded providers remain routable", () => {
  const projection = buildIntelligenceAvailabilityProjection({ company_id: "co-1", health: { local: "degraded" }, providers: [provider()], models: [model()] });
  assert.equal(projection.providers[0].health, "degraded");
  assert.equal(selectIntelligenceAvailabilityRoute({ company_id: "co-1", capability: "chat", privacy: "public" }, projection).provider.id, "local");
  assert.throws(() => selectIntelligenceAvailabilityRoute({ company_id: "co-2", capability: "chat", privacy: "public" }, projection), /cross-company/);
});
