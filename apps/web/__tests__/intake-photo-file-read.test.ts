import { describe,expect,it } from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import { readPrivateIntakeFile,writePrivateIntakeFile } from "../lib/intake/media-files";
function fixture(fn:(root:string)=>void){const root=fs.mkdtempSync(path.join(os.tmpdir(),"sorted-photo-read-"));try{fn(root)}finally{fs.rmSync(root,{recursive:true,force:true})}}
describe("private authenticated intake photo read boundary",()=>{
 it("reads a valid private file without exposing a path",()=>fixture(root=>{
  const file=path.join(root,"nested","picture.jpg");
  writePrivateIntakeFile(file,new Uint8Array([0xff,0xd8,0xff,1]));
  expect(readPrivateIntakeFile(file)).toEqual(new Uint8Array([0xff,0xd8,0xff,1]));
 }));
 it("returns null for an absent file",()=>fixture(root=>{
  expect(readPrivateIntakeFile(path.join(root,"missing.jpg"))).toBeNull();
 }));
 it("does not follow a symlink in the final filename",()=>fixture(root=>{
  const safe=path.join(root,"safe.jpg"),link=path.join(root,"link.jpg");
  fs.writeFileSync(safe,Buffer.from([1,2,3]));fs.symlinkSync(safe,link);
  expect(readPrivateIntakeFile(link)).toBeNull();
 }));
 it("does not traverse a symlinked parent to another directory",()=>fixture(root=>{
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),"photo-read-outside-"));
  try{
   fs.writeFileSync(path.join(outside,"image.jpg"),Buffer.from([9,8,7]));
   fs.symlinkSync(outside,path.join(root,"redirect"));
   expect(readPrivateIntakeFile(path.join(root,"redirect","image.jpg"))).toBeNull();
  }finally{fs.rmSync(outside,{recursive:true,force:true})}
 }));
 it("rejects empty and oversized files rather than buffering them",()=>fixture(root=>{
  const empty=path.join(root,"empty.jpg"),large=path.join(root,"large.jpg");
  fs.writeFileSync(empty,Buffer.alloc(0));fs.writeFileSync(large,Buffer.alloc(10*1024*1024+1));
  expect(readPrivateIntakeFile(empty)).toBeNull();
  expect(readPrivateIntakeFile(large)).toBeNull();
 }));
});
