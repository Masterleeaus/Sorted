import { describe, expect, it } from "vitest";
import { portalMagicLinkHtml } from "@ai-fsm/email-templates";
// Carried from PR 30; the helper now lives in packages/email-templates (main).
describe("portal email HTML boundary", () => {
 it("escapes untrusted booking names", () => {
  const html=portalMagicLinkHtml("<img src=x onerror=evil()> Customer","https://example.test/verify");
  expect(html).not.toContain("<img src=x");
  expect(html).toContain("&lt;img");
 });
 it("blocks script URLs", () => {
  expect(portalMagicLinkHtml("Jane","javascript:evil()")).toContain('href="#"');
 });
 it("encodes token URLs without losing query parameters", () => {
  expect(portalMagicLinkHtml("Jane","https://example.test/verify?token=a&ref=b")).toContain('token=a&amp;ref=b');
 });
});