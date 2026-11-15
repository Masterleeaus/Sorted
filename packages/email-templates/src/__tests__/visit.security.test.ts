import { describe, expect, it } from "vitest";
import { visitReminderEmailHtml, onMyWayEmailHtml, bookingConfirmedEmailHtml } from "../visit.js";
const bad = '<img src=x onerror=evil()>&"';
const d={clientName:bad,jobTitle:bad,propertyAddress:bad,techName:bad};
describe("visit content escaping", () => {
 it("escapes reminder markup", () => {
  expect(visitReminderEmailHtml({...d,scheduledStart:"2026-08-01T10:00:00Z"})).not.toContain("<img src=x");
 });
 it("escapes on-my-way markup", () => {
  expect(onMyWayEmailHtml({...d,when:bad})).not.toContain("<img src=x");
 });
 it("escapes booking markup", () => {
  expect(bookingConfirmedEmailHtml({...d,scheduledStart:"2026-08-01T10:00:00Z",scheduledEnd:"2026-08-01T11:00:00Z"})).not.toContain("<img src=x");
 });
});