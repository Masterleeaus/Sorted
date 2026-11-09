import { describe,it,expect,beforeAll,afterAll } from "vitest";
import { createIntakeMediaDbFixture } from "./media-db-fixture";
type F = Awaited<ReturnType<typeof createIntakeMediaDbFixture>>;
describe.skipIf(!process.env.TEST_DATABASE_URL)("intake media tenant mutation integrity",()=>{
 let f:F;
 beforeAll(async()=>{f=await createIntakeMediaDbFixture()});
 afterAll(async()=>{await f.cleanup()});
 it("refuses to reassign existing media to a different tenant",async()=>{
  const id=await f.insertMedia();
  await expect(f.pool.query("UPDATE intake_media SET account_id=$1 WHERE id=$2",[f.accountB,id])).rejects.toMatchObject({code:"23503"});
  const {rows}=await f.pool.query("SELECT account_id FROM intake_media WHERE id=$1",[id]);
  expect(rows[0].account_id).toBe(f.accountA);
 });
 it("refuses to replace a valid booking link with a cross-account booking",async()=>{
  const id=await f.insertMedia();
  await expect(f.pool.query("UPDATE intake_media SET booking_request_id=$1 WHERE id=$2",[f.requestB,id])).rejects.toMatchObject({code:"23503"});
 });
 it("allows valid later attachment to its original booking",async()=>{
  const id=await f.insertMedia(f.accountA,f.inviteA,null);
  await f.pool.query("UPDATE intake_media SET booking_request_id=$1 WHERE id=$2",[f.requestA,id]);
  const {rows}=await f.pool.query("SELECT booking_request_id FROM intake_media WHERE id=$1",[id]);
  expect(rows[0].booking_request_id).toBe(f.requestA);
 });
});
