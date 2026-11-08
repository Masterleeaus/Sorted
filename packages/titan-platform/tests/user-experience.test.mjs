import test from "node:test";
import assert from "node:assert/strict";
import { ExperiencePresentationStore, composeExperiencePresentation, createThemePack, validateThemePack } from "../.test-dist/user-experience.js";

const contribution = (overrides = {}) => ({ id: "workforce", label: "Workforce", group: "business", state: "installed", ...overrides });

test("composes grouped navigation and responsive presentation-only presets", () => {
  const view = composeExperiencePresentation({ company_id: "co-1", profile: "manager", contributions: [contribution(), contribution({ id: "broken", label: "Broken", state: "missing", group: "system" })] });
  assert.equal(view.authority, "presentation-only"); assert.equal(view.business_writes, false);
  assert.deepEqual(view.preset.grid, { desktop: 12, tablet: 8, mobile: 4 }); assert.deepEqual(view.navigation.map((x) => x.group), ["business", "system"]);
});

test("preview is side-effect free and company switching cannot reuse presentation state", () => {
  const store = new ExperiencePresentationStore(composeExperiencePresentation({ company_id: "co-1", profile: "owner" }));
  const preview = composeExperiencePresentation({ company_id: "co-1", profile: "developer" });
  assert.equal(store.preview(preview).profile, "developer"); assert.equal(store.current.profile, "owner");
  assert.throws(() => store.preview(composeExperiencePresentation({ company_id: "co-2", profile: "owner" })), /company-context/);
});

test("applied presentation versions roll back without rewriting history", () => {
  const store = new ExperiencePresentationStore(composeExperiencePresentation({ company_id: "co-1", profile: "owner" }));
  store.apply(composeExperiencePresentation({ company_id: "co-1", profile: "manager" }));
  assert.equal(store.historyLength, 1); assert.equal(store.rollback().profile, "owner"); assert.equal(store.historyLength, 0);
});

test("theme import rejects executable content and normalizes safe colors", () => {
  const pack = createThemePack({ id: "safe", version: "1.0.0", tokens: { primary: "not-a-color" } });
  assert.equal(validateThemePack(pack), true); assert.equal(pack.tokens.primary, "#2563eb");
  assert.throws(() => createThemePack({ id: "unsafe", version: "1.0.0", tokens: { primary: "javascript:alert(1)" } }), /executable-content/);
  assert.throws(() => validateThemePack({ schema: "titan.experience.theme-pack.v1", id: "unsafe", version: "1", tokens: {}, script: "alert(1)" }), /executable-content/);
});

