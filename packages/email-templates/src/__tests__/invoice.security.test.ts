import { describe, expect, it } from "vitest";
import { invoiceEmailHtml, invoiceEmailText, invoiceFollowupEmailHtml } from "../invoice.js";
const bad = '<svg onload=evil()>&"';
const d = { invoiceNumber: bad, clientName: bad, totalCents: 100, balanceCents: 100,
  dueDateStr: bad, notes: bad, viewUrl: "javascript:alert(1)" };
describe("invoice HTML injection", () => {
 it("escapes customer, notes, invoice identity, and unsafe URL", () => {
  const html = invoiceEmailHtml(d);
  expect(html).not.toContain("<svg onload");
  expect(html).toContain("&lt;svg");
  expect(html).toContain('href="#"');
 });
 it("protects paid receipt and overdue reminders", () => {
  expect(invoiceEmailHtml({...d,isPaid:true,paidAtStr:bad})).not.toContain("<svg onload");
  expect(invoiceFollowupEmailHtml({ clientName:bad,invoiceNumber:bad,
   totalCents:100,balanceCents:100,daysOverdue:1,viewUrl:"javascript:alert(1)" })).not.toContain("<svg onload");
 });
 it("keeps plain-text invoice content unencoded", () => {
  expect(invoiceEmailText(d)).toContain(bad);
 });
});