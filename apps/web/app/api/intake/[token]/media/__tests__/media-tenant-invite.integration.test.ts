import { describe,it,expect,beforeAll,afterAll } from "vitest";
import { createIntakeMediaDbFixture } from "./media-db-fixture";
type F = Awaited<ReturnType<typeof createIntakeMediaDbFixture>>;
describe.skipIf(!process.env.TEST_DATABASE_URL)("intake media invitation tenant foreign key",()=>{
 let f:F;
 beforeAll(async()=>{f=await createIntakeMediaDbFixture()});
 afterAll(async()=>{await f.cleanup()});
 it("accepts a media row belonging to its invitation and account",async()=>{
  const id=await f.insertMedia();
  const {rows}=await f.pool.query("SELECT account_id,intake_invite_id FROM intake_media WHERE id=$1",[id]);
  expect(rows[0]).toMatchObject({account_id:f.accountA,intake_invite_id:f.inviteA});
 });
 it("rejects linking account A media to account B invitation",async()=>{
  await expect(f.insertMedia(f.accountA,f.inviteB,null)).rejects.toMatchObject({code:"23503"});
 });
 it("rejects linking account B media to account A invitation",async()=>{
  await expect(f.insertMedia(f.accountB,f.inviteA,null)).rejects.toMatchObject({code:"23503"});
 });
});
