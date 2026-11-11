import { describe,expect,it } from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import { writePrivateIntakeFile } from "../lib/intake/media-files";
function withDir(fn:(root:string)=>void){const root=fs.mkdtempSync(path.join(os.tmpdir(),"sorted-photo-"));try{fn(root)}finally{fs.rmSync(root,{recursive:true,force:true})}}
describe("private photo file writes",()=>{
 it("creates only new files and preserves exact bytes",()=>withDir(root=>{
  const target=path.join(root,"nested","photo.jpg");const payload=new Uint8Array([0,255,17,42]);
  writePrivateIntakeFile(target,payload);expect(fs.readFileSync(target)).toEqual(Buffer.from(payload));
  expect(()=>writePrivateIntakeFile(target,payload)).toThrow();
 }));
 it("uses owner-only permissions for new files and directories on POSIX",()=>withDir(root=>{
  const target=path.join(root,"nested","image.png");writePrivateIntakeFile(target,new Uint8Array([1]));
  if(process.platform!=="win32"){
   expect(fs.statSync(target).mode&0o777).toBe(0o600);
   expect(fs.statSync(path.dirname(target)).mode&0o777).toBe(0o700);
  }
 }));
 it("refuses to follow a symlinked parent into another directory",()=>withDir(root=>{
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),"sorted-photo-outside-"));
  try{
   fs.symlinkSync(outside,path.join(root,"redirect"));
   expect(()=>writePrivateIntakeFile(path.join(root,"redirect","escape.jpg"),new Uint8Array([1]))).toThrow(/not a directory/);
   expect(fs.existsSync(path.join(outside,"escape.jpg"))).toBe(false);
  }finally{fs.rmSync(outside,{recursive:true,force:true})}
 }));
});
