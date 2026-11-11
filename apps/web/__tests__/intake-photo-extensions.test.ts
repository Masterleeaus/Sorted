import { describe,expect,it } from "vitest";
import { INTAKE_PHOTO_ACCEPT,INTAKE_PHOTO_EXTENSION,INTAKE_PHOTO_MIME_TYPES,isIntakePhotoMime } from "../lib/intake/photos";
describe("stored public intake image format policy",()=>{
 it("advertises exactly the mime formats the server can write",()=>{
  expect(INTAKE_PHOTO_ACCEPT.split(",")).toEqual([...INTAKE_PHOTO_MIME_TYPES]);
  expect(Object.keys(INTAKE_PHOTO_EXTENSION).sort()).toEqual([...INTAKE_PHOTO_MIME_TYPES].sort());
 });
 it.each(["image/jpeg","image/png","image/webp","image/gif","image/heic","image/heif"])("only known MIME can form stored images",mime=>expect(isIntakePhotoMime(mime)).toBe(true));
 it.each(["image/svg+xml","text/html","application/pdf","application/octet-stream"])("dangerous unlisted formats rejected",mime=>expect(isIntakePhotoMime(mime)).toBe(false));
});
