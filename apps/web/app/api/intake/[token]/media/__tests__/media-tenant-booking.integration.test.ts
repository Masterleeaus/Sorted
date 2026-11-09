import { describe,it,expect,beforeAll,afterAll } from "vitest";
import { createIntakeMediaDbFixture } from "./media-db-fixture";
type F = Awaited<ReturnType<typeof createIntakeMediaDbFixture>>;
describe.skipIf(!process.env.TEST_DATABASE_URL)("intake media booking tenant foreign key",()=>{
 let f:F;
 beforeAll(async()=>{f=await createIntakeMediaDbFixture()});
 afterAll(async()=>{await f.cleanup()});
 it("accepts a booking belonging to the owning invite account",async()=>{
  const id=await f.insertMedia();
  const {rows}=await f.pool.query("SELECT booking_request_id FROM intake_media WHERE id=$1",[id]);
  expect(rows[0].booking_request_id).toBe(f.requestA);
 });
 it("rejects cross-account booking association even for same-account invitation",async()=>{
  await expect(f.insertMedia(f.accountA,f.inviteA,f.requestB)).rejects.toMatchObject({code:"23503"});
 });
 it("permits unassociated media while an invite is being completed",async()=>{
  const id=await f.insertMedia(f.accountA,f.inviteA,null);
  const {rows}=await f.pool.query("SELECT booking_request_id FROM intake_media WHERE id=$1",[id]);
  expect(rows[0].booking_request_id).toBeNull();
 });
});
