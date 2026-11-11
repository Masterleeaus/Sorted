import { describe,expect,it } from "vitest";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import { writePrivateIntakeFile,removePrivateIntakeFile } from "../lib/intake/media-files";
function fixture(fn:(root:string)=>void){const root=fs.mkdtempSync(path.join(os.tmpdir(),"sorted-photo-remove-"));try{fn(root)}finally{fs.rmSync(root,{recursive:true,force:true})}}
describe("private intake file removal",()=>{
 it("deletes one regular media file",()=>fixture(root=>{const target=path.join(root,"a.jpg");writePrivateIntakeFile(target,new Uint8Array([4]));expect(removePrivateIntakeFile(target)).toBe("deleted");expect(fs.existsSync(target)).toBe(false)}));
 it("treats missing file as idempotent cleanup",()=>fixture(root=>expect(removePrivateIntakeFile(path.join(root,"missing.jpg"))).toBe("missing")));
 it("refuses a symlink and does not delete its destination",()=>fixture(root=>{
  const stored=path.join(root,"stored");const link=path.join(root,"link");fs.writeFileSync(stored,"keep");fs.symlinkSync(stored,link);
  expect(()=>removePrivateIntakeFile(link)).toThrow(/nonregular/);expect(fs.readFileSync(stored,"utf8")).toBe("keep");
 }));
 it("refuses to delete directories",()=>fixture(root=>expect(()=>removePrivateIntakeFile(root)).toThrow(/nonregular/)));
});
