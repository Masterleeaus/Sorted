import { describe,it,expect,beforeAll,afterAll } from "vitest";
import { createIntakeMediaDbFixture } from "./media-db-fixture";
type F = Awaited<ReturnType<typeof createIntakeMediaDbFixture>>;
describe.skipIf(!process.env.TEST_DATABASE_URL)("intake media database validation",()=>{
 let f:F;
 beforeAll(async()=>{f=await createIntakeMediaDbFixture()});
 afterAll(async()=>{await f.cleanup()});
 it("refuses zero-sized media rows",async()=>{
  await expect(f.pool.query(`INSERT INTO intake_media(account_id,intake_invite_id,filename,original_name,mime_type,size_bytes)
  VALUES($1,$2,'zero.jpg','zero.jpg','image/jpeg',0)`,[f.accountA,f.inviteA])).rejects.toMatchObject({code:"23514"});
 });
 it("refuses files larger than ten MiB",async()=>{
  await expect(f.pool.query(`INSERT INTO intake_media(account_id,intake_invite_id,filename,original_name,mime_type,size_bytes)
  VALUES($1,$2,'large.jpg','large.jpg','image/jpeg',10485761)`,[f.accountA,f.inviteA])).rejects.toMatchObject({code:"23514"});
 });
 it("refuses SVG and executable MIME declarations in persisted records",async()=>{
  await expect(f.pool.query(`INSERT INTO intake_media(account_id,intake_invite_id,filename,original_name,mime_type,size_bytes)
  VALUES($1,$2,'svg.jpg','svg.jpg','image/svg+xml',20)`,[f.accountA,f.inviteA])).rejects.toMatchObject({code:"23514"});
 });
});
