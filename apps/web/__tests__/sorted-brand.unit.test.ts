import { describe, expect, it } from "vitest";
import manifest from "../app/manifest";
import { CURRENT_TITAN_GO_MODE_META } from "../lib/titan-go/modes";

describe("Sorted Field identity", () => {
  it("advertises Sorted as the installable app rather than a multi-product shell", () => {
    const app = manifest();
    expect(app.name).toBe("Sorted");
    expect(app.short_name).toBe("Sorted");
    expect(app.description).toContain("field service");
    expect(app.description).not.toMatch(/Titan Go|Supercharged|LMS/i);
    expect(app.start_url).toBe("/app");
    expect(app.display).toBe("standalone");
  });

  it("keeps the current Field mode branded as Sorted", () => {
    expect(CURRENT_TITAN_GO_MODE_META.id).toBe("field");
    expect(CURRENT_TITAN_GO_MODE_META.label).toBe("Sorted Field");
  });

  it("keeps shortcut destinations inside the Field app", () => {
    const app = manifest();
    expect(app.shortcuts?.map((shortcut) => shortcut.url)).toEqual([
      "/app",
      "/app/my-work",
      "/app/workforce",
    ]);
  });
});
