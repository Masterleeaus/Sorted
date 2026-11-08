import { describe, expect, it } from "vitest";
import { normalizeHostSurface, projectHostNavigation } from "../host";

describe("base web host surface navigation", () => {
  it("normalizes compatibility surface names without expanding authority", () => {
    expect(normalizeHostSurface("command")).toBe("zero");
    expect(normalizeHostSurface("field")).toBe("go");
    expect(normalizeHostSurface("customer")).toBe("hub");
    for (const surface of ["zero", "go", "hub"]) {
      const navigation = projectHostNavigation(surface);
      expect(navigation.length).toBeGreaterThan(0);
      expect(navigation.every(item => item.surface === surface && item.authority === "navigation-only")).toBe(true);
    }
  });
  it("rejects onboarding as a host mode instead of inventing navigation", () => {
    expect(() => normalizeHostSurface("onboarding")).toThrow("unsupported host surface");
  });
  it("rejects unknown host modes", () => {
    expect(() => normalizeHostSurface("administrator")).toThrow("unsupported product surface");
  });
});
