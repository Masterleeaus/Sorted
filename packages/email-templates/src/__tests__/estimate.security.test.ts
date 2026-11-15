import { describe, expect, it } from "vitest";
import { estimateEmailHtml, estimateFollowupHtml, estimateEmailText } from "../estimate.js";
const bad = '<svg onload=evil()>&"';
const d = {estimateRef:bad,clientName:bad,totalCents:100,depositCents:50,
 balanceCents:50,expiresStr:bad,notes:bad,approveUrl:"javascript:alert(1)",
 declineUrl:"data:text/html,evil",viewUrl:"javascript:alert(1)"};
describe("estimate markup isolation", () => {
 it("escapes customer data and all action URLs", () => {
  const html=estimateEmailHtml(d);
  expect(html).not.toContain("<svg onload");
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('href="data:');
 });
 it("protects follow-up links", () => {
  const html=estimateFollowupHtml({clientName:bad,estimateNumber:bad,totalCents:100,daysSinceSent:2,viewUrl:"javascript:alert(1)"});
  expect(html).toContain('href="#"');
  expect(html).not.toContain("<svg onload");
 });
 it("leaves plain-text estimates intact", () => {
  expect(estimateEmailText(d)).toContain(bad);
 });
});