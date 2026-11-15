import { describe,it,expect,beforeEach,vi } from "vitest";
import { NextRequest } from "next/server";
const state=vi.hoisted(()=>({
  photo:null as null|{intake_invite_id:string;filename:string;mime_type:string},
  bytes:new Uint8Array([255,216,255,1]) as Uint8Array|null,
  queries:[] as Array<{sql:string;params:unknown[]}>,
}));
vi.mock("@/lib/auth/middleware",()=>({withRole:(_roles:unknown,handler:unknown)=>handler}));
vi.mock("@/lib/db",()=>({
  withDbSession:async (_session:unknown,cb:(client:unknown)=>Promise<unknown>) =>
    cb({query:async(sql:string,params:unknown[])=>{
      state.queries.push({sql,params});
      return {rows:state.photo?[state.photo]:[]};
    }}),
}));
vi.mock("@/lib/intake/media-files",()=>({readPrivateIntakeFile:()=>state.bytes}));
import { GET } from "../route";
const booking="11111111-1111-4111-8111-111111111111";
const media="22222222-2222-4222-8222-222222222222";
const account="33333333-3333-4333-8333-333333333333";
const invite="44444444-4444-4444-8444-444444444444";
const route=GET as unknown as (request:NextRequest,session:{accountId:string;role:string})=>Promise<Response>;
const request=(b=booking,m=media)=>new NextRequest(`http://localhost/api/v1/booking-requests/${b}/media/${m}`);
beforeEach(()=>{
 state.photo={intake_invite_id:invite,filename:"55555555-5555-4555-8555-555555555555.jpg",mime_type:"image/jpeg"};
 state.bytes=new Uint8Array([255,216,255,1]);state.queries=[];
});
describe("private intake photo download",()=>{
 it("only returns approved image bytes with no-store and nosniff headers",async()=>{
  const response=await route(request(),{accountId:account,role:"owner"});
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-disposition")).toContain("attachment");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255,216,255,1]));
 });
 it("does not touch private storage for an unknown photo or booking",async()=>{
  state.photo=null;
  expect((await route(request(),{accountId:account,role:"admin"})).status).toBe(404);
 });
 it("returns 404 for missing private file bytes",async()=>{
  state.bytes=null;
  expect((await route(request(),{accountId:account,role:"owner"})).status).toBe(404);
 });
 it("rejects invalid IDs before querying storage",async()=>{
  expect((await route(request("bad",media),{accountId:account,role:"owner"})).status).toBe(404);
  expect(state.queries).toHaveLength(0);
 });
 it("looks up one media ID and one booking ID under current tenant",async()=>{
  await route(request(),{accountId:account,role:"owner"});
  expect(state.queries).toHaveLength(1);
  expect(state.queries[0].params).toEqual([media,booking,account]);
  expect(state.queries[0].sql).toMatch(/im.account_id = \$3 AND br.account_id = \$3/);
 });
});
