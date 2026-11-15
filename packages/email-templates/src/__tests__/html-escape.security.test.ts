import { describe, expect, it } from "vitest";
import { escapeHtml } from "../escape.js";
describe("HTML text encoding", () => {
 it("encodes unsafe text and attributes", () => {
  expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
 });
 it("handles empty values without emitting undefined", () => {
  expect(escapeHtml(null)).toBe("");
 });
});
