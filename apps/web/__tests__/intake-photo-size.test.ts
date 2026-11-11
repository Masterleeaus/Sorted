import { describe, expect, it } from "vitest";
import { MAX_INTAKE_PHOTO_BYTES, MAX_INTAKE_PHOTOS, validateIntakePhotoMeta } from "../lib/intake/photos";
describe("public intake photo quotas", () => {
 it("accepts the precise 10 MB boundary",()=>expect(validateIntakePhotoMeta({type:"image/png",size:MAX_INTAKE_PHOTO_BYTES})).toBeNull());
 it("rejects one byte over quota",()=>expect(validateIntakePhotoMeta({type:"image/png",size:MAX_INTAKE_PHOTO_BYTES+1})).toMatch(/larger/));
 it.each([0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])("rejects malformed size %s",(size)=>expect(validateIntakePhotoMeta({type:"image/png",size})).not.toBeNull());
 it("rejects executable content declared as a photo",()=>expect(validateIntakePhotoMeta({type:"application/javascript",size:20})).toMatch(/Only photos/));
 it("caps the total attachment count at eight",()=>expect(MAX_INTAKE_PHOTOS).toBe(8));
});
