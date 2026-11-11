import { describe, expect, it } from "vitest";
import { safeEmailHref, btn } from "../layout.js";
describe("email link URL boundaries", () => {
 it.each(["javascript:alert(1)", "data:text/html,evil", "file:///etc/passwd",
  "//evil.example", "http://evil.example", "https://u:p@example.test",
  "https://example.test/\\escape", " https://example.test"])("rejects %s", href => {
  expect(safeEmailHref(href)).toBe("#");
  expect(btn(href, "Open")).toContain('href="#"');
 });
 it.each(["https://example.test/path?a=1&b=2", "http://localhost:3000/app",
  "/app/invoices/123"])("allows %s", href => {
   expect(safeEmailHref(href)).toBe(href);
 });
});