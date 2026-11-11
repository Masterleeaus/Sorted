import { describe, expect, it } from "vitest";
import { invoiceEmailText } from "../invoice.js";
import { estimateEmailText } from "../estimate.js";
describe("unmodified plain-text customer copy", () => {
 const name="A&B <tag> 'quoted'";
 it("leaves invoice text readable", () => {
  expect(invoiceEmailText({invoiceNumber:"INV",clientName:name,totalCents:1,
    balanceCents:1,dueDateStr:null,notes:name,viewUrl:"https://example.test"})).toContain(name);
 });
 it("leaves estimate text readable", () => {
  expect(estimateEmailText({estimateRef:"EST",clientName:name,totalCents:1,
    depositCents:0,balanceCents:1,expiresStr:null,notes:name,
    approveUrl:"https://example.test",declineUrl:"https://example.test",
    viewUrl:"https://example.test"})).toContain(name);
 });
});