import { describe,it,expect,beforeAll,afterAll } from "vitest";
import { createIntakeMediaDbFixture } from "./media-db-fixture";
type F = Awaited<ReturnType<typeof createIntakeMediaDbFixture>>;
describe.skipIf(!process.env.TEST_DATABASE_URL)("intake media cascading lifecycle",()=>{
 let f:F;
 beforeAll(async()=>{f=await createIntakeMediaDbFixture()});
 afterAll(async()=>{await f.cleanup()});
 it("deleting an invitation removes its media rows",async()=>{
  const id=await f.insertMedia();
  await f.pool.query("DELETE FROM intake_invites WHERE id=$1",[f.inviteA]);
  const {rowCount}=await f.pool.query("SELECT 1 FROM intake_media WHERE id=$1",[id]);
  expect(rowCount).toBe(0);
 });
 it("preserves another account's media when deleting tenant A invitation",async()=>{
  const id=await f.insertMedia(f.accountB,f.inviteB,f.requestB);
  const {rowCount}=await f.pool.query("SELECT 1 FROM intake_media WHERE id=$1",[id]);
  expect(rowCount).toBe(1);
 });
});
