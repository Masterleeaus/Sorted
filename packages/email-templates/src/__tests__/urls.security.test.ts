import { describe, expect, it } from "vitest";
import { btn } from "../layout.js";
import { hrefAttr } from "../escape.js";
// Carried from PR 30; helpers now come from escape.ts (main's hardened version).
// Relative paths fail closed on main, so they are not in the allow list.
// Leading whitespace is trimmed on main (not rejected), so it is not listed here.
describe("email link URL boundaries", () => {
 it.each(["javascript:alert(1)", "data:text/html,evil", "file:///etc/passwd",
  "//evil.example", "/app/invoices/123", "https://u:p@example.test",
 ])("rejects %s", href => {
  expect(hrefAttr(href)).toBe("#");
  expect(btn(href, "Open")).toContain('href="#"');
 });
 it.each(["https://example.test/path?a=1&b=2", "http://localhost:3000/app"])("allows %s", href => {
   expect(hrefAttr(href)).toBe(href.replace(/&/g, "&amp;"));
 });
});
