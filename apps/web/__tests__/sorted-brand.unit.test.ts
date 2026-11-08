import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shellSource = readFileSync(fileURLToPath(new URL("../components/AppShell.tsx", import.meta.url)), "utf8");
const layoutSource = readFileSync(fileURLToPath(new URL("../app/layout.tsx", import.meta.url)), "utf8");
const loginSource = readFileSync(fileURLToPath(new URL("../app/(auth)/login/page.tsx", import.meta.url)), "utf8");
const workerSource = readFileSync(fileURLToPath(new URL("../public/sw.js", import.meta.url)), "utf8");
const actionMenuSource = readFileSync(fileURLToPath(new URL("../components/NewActionMenu.tsx", import.meta.url)), "utf8");
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

describe("Sorted Field UI branding", () => {
  it("keeps desktop, mobile, and accessibility surfaces aligned", () => {
    expect(shellSource).toContain("<b>Sorted <em>Field</em></b>");
    expect(shellSource).toContain("<b>SORTED</b>");
    expect(shellSource).toContain("Sorted Field navigation");
    expect(shellSource).toContain("Sorted Field menu");
    expect(shellSource).not.toContain("<b>Titan <em>Field</em></b>");
    expect(shellSource).not.toContain("Titan Go Field home");
    expect(shellSource).not.toContain("Titan Zero Field navigation");
  });

  it("keeps browser chrome and installable PWA theme consistent", () => {
    const app = manifest();
    expect(app.theme_color).toBe("#17365d");
    expect(layoutSource).toContain(`themeColor: "${app.theme_color}"`);
    expect(app.background_color).toBe("#070708");
  });

  it("uses Sorted in server-side metadata", () => {
    expect(layoutSource).toContain('applicationName: "Sorted"');
    expect(layoutSource).toContain('title: "Sorted"');
  });
});

describe("Sorted Field login", () => {
  it("does not advertise an unrelated app or an unavailable multi-mode login", () => {
    expect(loginSource).toContain("SORTED · FIELD OPERATIONS");
    expect(loginSource).toContain("Enter Sorted");
    expect(loginSource).toContain("field operations and assigned work");
    expect(loginSource).not.toMatch(/TITAN GO|Titan Go|titan-zero-field-lockup/);
  });
});

describe("Sorted Field notifications and action menu", () => {
  it("uses Sorted as the notification fallback while preserving the supplied message title", () => {
    expect(workerSource).toContain('const title = msg.title || "Sorted"');
    expect(workerSource).toContain('msg = { title: "Sorted"');
    expect(workerSource).not.toContain('"Titan Go"');
    expect(workerSource).toContain('self.registration.showNotification(title');
  });

  it("names the create menu after Sorted Field", () => {
    expect(actionMenuSource).toContain('aria-label="Create in Sorted Field"');
    expect(actionMenuSource).not.toContain('aria-label="Create in Titan Field"');
  });
});
