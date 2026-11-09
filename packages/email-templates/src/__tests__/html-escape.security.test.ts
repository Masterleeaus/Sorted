import { describe, expect, it } from "vitest";
import { escapeEmailText } from "../layout.js";
describe("HTML text encoding", () => {
 it("encodes unsafe text and attributes", () => {
  expect(escapeEmailText(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
 });
 it("handles empty values without emitting undefined", () => {
  expect(escapeEmailText(null)).toBe("");
 });
});