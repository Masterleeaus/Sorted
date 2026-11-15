import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Issue #29: user-facing Field surfaces must say "Sorted Field", not the old
// "Titan Field" / "Titan Go" product name. Titan Zero (the assistant name) is
// deliberately not checked here; see the decision note in the PR.
const WEB_ROOT = resolve(__dirname, "..");

const FIELD_SURFACES = [
  "components/CommandPalette.tsx",
  "app/not-found.tsx",
  "app/app/assets/page.tsx",
  "app/app/OwnerDashboard.tsx",
  "app/(auth)/login/page.tsx",
  "app/app/settings/page.tsx",
];

const OLD_BRAND = /Titan Field|TITAN FIELD|Titan Zero Field|Titan Go|TITAN GO/;

describe("Sorted Field brand leftovers (issue #29)", () => {
  for (const file of FIELD_SURFACES) {
    it(`${file} has no old Field brand string`, () => {
      const source = readFileSync(resolve(WEB_ROOT, file), "utf8");
      expect(source.match(OLD_BRAND)).toBeNull();
    });
  }
});
