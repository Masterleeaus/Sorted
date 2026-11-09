import { describe, expect, it } from "vitest";
import { clientReactivationHtml, seasonalReminderHtml, recurringInspectionHtml } from "../automation.js";
const bad='<svg onload=evil()>';
describe("automation email HTML", () => {
 it("escapes reactivation names", () => {
  expect(clientReactivationHtml({clientName:bad,monthsSinceLastService:3})).not.toContain("<svg onload");
 });
 it("escapes seasonal names", () => {
  expect(seasonalReminderHtml({clientName:bad,season:"spring"})).not.toContain("<svg onload");
 });
 it("escapes plan titles and addresses", () => {
  expect(recurringInspectionHtml({clientName:bad,planName:bad,propertyAddress:bad})).not.toContain("<svg onload");
 });
});