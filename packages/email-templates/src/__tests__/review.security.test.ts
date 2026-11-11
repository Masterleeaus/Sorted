import { describe, expect, it } from "vitest";
import { reviewRequestEmailHtml } from "../review.js";
describe("review request email escaping", () => {
 it("encodes customer, technician and job data", () => {
  const html=reviewRequestEmailHtml({clientName:"<script>evil()</script>",
   techName:"<svg onload=evil()>",jobTitle:'<a href="javascript:evil()">Job</a>'});
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<svg");
  expect(html).not.toContain('<a href="javascript:');
 });
});