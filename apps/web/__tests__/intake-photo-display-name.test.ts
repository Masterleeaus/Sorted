import { describe,expect,it } from "vitest";
import { sanitizeDisplayName } from "../lib/uploads/paths";
describe("public upload display names",()=>{
 it("removes Windows and Unix parent directory components",()=>{
  expect(sanitizeDisplayName("C:\\secrets\\profile.png")).toBe("profile.png");
  expect(sanitizeDisplayName("../../private/receipt.jpg")).toBe("receipt.jpg");
 });
 it("removes control bytes and leading dots",()=>{
  expect(sanitizeDisplayName("..bad\u0000name.jpg")).toBe("badname.jpg");
 });
 it("truncates long untrusted filenames",()=>{
  expect(sanitizeDisplayName("a".repeat(500))).toHaveLength(255);
 });
 it("replaces blank, hidden and missing names",()=>{
  for(const name of [null,undefined,"","."])expect(sanitizeDisplayName(name)).toBe("upload");
 });
});
