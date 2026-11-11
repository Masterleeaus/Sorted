import { describe, expect, it } from "vitest";
import { sniffIntakePhotoMime } from "../lib/intake/photos";
const bytes=(...a:number[])=>new Uint8Array(a);
describe("intake magic bytes",()=>{
 it("sniffs JPEG",()=>expect(sniffIntakePhotoMime(bytes(255,216,255,224,0))).toBe("image/jpeg"));
 it("sniffs PNG",()=>expect(sniffIntakePhotoMime(bytes(137,80,78,71,13,10,26,10))).toBe("image/png"));
 it("sniffs GIF87a/GIF89a",()=>{
  for(const sig of ["GIF87a","GIF89a"]) expect(sniffIntakePhotoMime(new TextEncoder().encode(sig))).toBe("image/gif");
 });
 it("sniffs WEBP RIFF",()=>{
  const sig=new Uint8Array(12);sig.set(new TextEncoder().encode("RIFF"));sig.set(new TextEncoder().encode("WEBP"),8);
  expect(sniffIntakePhotoMime(sig)).toBe("image/webp");
 });
 it("sniffs HEIC brand",()=>{
  const sig=new Uint8Array(12);sig.set(new TextEncoder().encode("ftyp"),4);sig.set(new TextEncoder().encode("heic"),8);
  expect(sniffIntakePhotoMime(sig)).toBe("image/heic");
 });
 it.each([new Uint8Array(0),bytes(1,2,3,4),new TextEncoder().encode("<script>")])("rejects unrecognized content",(file)=>expect(sniffIntakePhotoMime(file)).toBeNull());
});
