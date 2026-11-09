import { describe, expect, it } from "vitest";
import { intakeInviteEmailHtml, intakeInviteEmailText } from "../intake.js";
describe("public intake email safety", () => {
 it("escapes submitted names", () => {
  expect(intakeInviteEmailHtml({leadName:"<script>evil()</script>",intakeUrl:"https://example.test"})).not.toContain("<script>");
 });
 it("rejects script destination", () => {
  expect(intakeInviteEmailHtml({leadName:"Jane",intakeUrl:"javascript:evil()"})).toContain('href="#"');
 });
 it("does not HTML encode plain-text correspondence", () => {
  expect(intakeInviteEmailText({leadName:"<script>",intakeUrl:"https://example.test"})).toContain("<script>");
 });
});