import { describe,it,expect,beforeAll,afterAll } from "vitest";
import { Pool } from "pg";
import { createIntakeMediaDbFixture } from "./media-db-fixture";
type F=Awaited<ReturnType<typeof createIntakeMediaDbFixture>>;
describe.skipIf(!process.env.TEST_DATABASE_URL || !process.env.TEST_RUNTIME_DATABASE_URL)(
  "restricted web role cannot access another tenant's intake photos",()=>{
  let f:F,restricted:Pool,photoA:string,photoB:string;
  beforeAll(async()=>{
    f=await createIntakeMediaDbFixture();
    photoA=await f.insertMedia();photoB=await f.insertMedia(f.accountB,f.inviteB,f.requestB);
    restricted=new Pool({connectionString:process.env.TEST_RUNTIME_DATABASE_URL,max:2});
  });
  afterAll(async()=>{await restricted.end();await f.cleanup()});
  async function scoped<T>(tenant:string,callback:(client:Awaited<ReturnType<Pool["connect"]>>)=>Promise<T>):Promise<T>{
    const client=await restricted.connect();
    try{
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_account_id',$1,true)",[tenant]);
      return await callback(client);
    }finally{await client.query("ROLLBACK").catch(()=>undefined);client.release()}
  }
  it("selects only media of the requested account under RLS",async()=>{
    const ids=await scoped(f.accountA,async c=>(await c.query<{id:string}>("SELECT id FROM intake_media WHERE id=ANY($1::uuid[])",[[photoA,photoB]])).rows.map(r=>r.id));
    expect(ids).toEqual([photoA]);
  });
  it("cannot delete another account's media while scoped to current account",async()=>{
    const count=await scoped(f.accountA,async c=>(await c.query("DELETE FROM intake_media WHERE id=$1 RETURNING id",[photoB])).rowCount);
    expect(count).toBe(0);
    expect((await f.pool.query("SELECT 1 FROM intake_media WHERE id=$1",[photoB])).rowCount).toBe(1);
  });
  it("cannot update another account's media",async()=>{
    const count=await scoped(f.accountA,async c=>(await c.query("UPDATE intake_media SET original_name='forged.jpg' WHERE id=$1 RETURNING id",[photoB])).rowCount);
    expect(count).toBe(0);
  });
  it("cannot insert a media row with another account ID",async()=>{
    await expect(scoped(f.accountA,async c=>c.query(
      `INSERT INTO intake_media(account_id,intake_invite_id,filename,original_name,mime_type,size_bytes)
       VALUES($1,$2,$3,'forged.jpg','image/jpeg',10)`,
      [f.accountB,f.inviteB,"fake-"+photoB+".jpg"]
    ))).rejects.toMatchObject({code:"42501"});
  });
});