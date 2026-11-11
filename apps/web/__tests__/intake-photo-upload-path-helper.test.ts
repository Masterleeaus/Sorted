import { describe, expect, it } from "vitest";
import path from "node:path";
import { isSafePathSegment, isStoredFilename, resolveStoredUpload } from "../lib/uploads/paths";
describe("shared upload path traversal boundary",()=>{
 it("rejects separators and segments capable of escaping the root",()=>{
  for(const bad of [".","..","a/../b","a\\b","", "%2e%2e/"]) expect(isSafePathSegment(bad)).toBe(false);
 });
 it("rejects untrusted path segments in stored filenames",()=>{
  for(const bad of ["a/../b.jpg","../secret.jpg","photo.jpg/other","no-extension","a.jpg\\evil"]) expect(isStoredFilename(bad)).toBe(false);
 });
 it("resolves a safe server-generated relative file into its owner directory",()=>{
  const base=path.resolve("/app/uploads/intake");
  expect(resolveStoredUpload(base,"invite_12","image_34.jpg")).toBe(path.join(base,"invite_12","image_34.jpg"));
 });
 it("does not permit owner or filename traversal outside the root",()=>{
  const base=path.resolve("/app/uploads/intake");
  for(const owner of ["..","../../../etc","x/y"]) expect(resolveStoredUpload(base,owner,"image.jpg")).toBeNull();
  for(const name of ["../escape.jpg","/etc/passwd","image.jpg/../../../"]) expect(resolveStoredUpload(base,"owner",name)).toBeNull();
 });
});
