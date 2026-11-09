import { describe,expect,it } from "vitest";
import path from "node:path";
import { INTAKE_MEDIA_ROOT,intakeMediaFilePath } from "../lib/intake/media-storage";
const id="31c708ab-e980-4b93-a0b4-1d6e358fc290";
const filename="5b6277c8-00fd-4a2f-85e3-922307ef68cc.jpg";
describe("private intake media path",()=>{
 it("scopes file to invite beneath nonpublic root",()=>{
  expect(intakeMediaFilePath(id,filename)).toBe(path.join(INTAKE_MEDIA_ROOT,id,filename));
  expect(INTAKE_MEDIA_ROOT).not.toContain("/public/");
 });
 it.each(["../etc/passwd","../../other","not-an-invite","5b6277c8-00fd-4a2f-85e3-922307ef68cc"])("rejects invalid invite IDs: %s",(candidate)=>expect(intakeMediaFilePath(candidate,filename)).toBeNull());
 it.each(["../../etc/passwd","a.jpg","5b6277c8-00fd-4a2f-85e3-922307ef68cc.exe","/etc/passwd"])("rejects untrusted filenames: %s",(candidate)=>expect(intakeMediaFilePath(id,candidate)).toBeNull());
});
