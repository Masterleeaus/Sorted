import { describe,it,expect,beforeEach,vi } from "vitest";
import { NextRequest } from "next/server";
const db=vi.hoisted(()=>({booking:true,entries:[{id:"88888888-8888-4888-8888-888888888888",original_name:"kitchen.jpg",mime_type:"image/jpeg",size_bytes:3}],queries:[] as Array<{sql:string;params:unknown[]}>}));
vi.mock("@/lib/auth/middleware",()=>({withRole:(_roles:unknown,handler:unknown)=>handler}));
vi.mock("@/lib/db",()=>({withDbSession:async(_session:unknown,cb:(client:unknown)=>Promise<unknown>)=>
  cb({query:async(sql:string,params:unknown[])=>{
    db.queries.push({sql,params});
    return {rows:sql.includes("FROM booking_requests") ? (db.booking ? [{id:params[0]}]:[]) : db.entries};
  }})}));
import { GET } from "../route";
const booking="11111111-1111-4111-8111-111111111111";
const account="22222222-2222-4222-8222-222222222222";
const route=GET as unknown as (request:NextRequest,session:{accountId:string;role:string})=>Promise<Response>;
const request=(id=booking)=>new NextRequest(`http://localhost/api/v1/booking-requests/${id}/media`);
beforeEach(()=>{db.booking=true;db.entries=[{id:"88888888-8888-4888-8888-888888888888",original_name:"kitchen.jpg",mime_type:"image/jpeg",size_bytes:3}];db.queries=[]});
describe("authenticated account-scoped intake inventory",()=>{
 it("returns metadata without a guessable or raw filesystem path",async()=>{
  const response=await route(request(),{accountId:account,role:"owner"});
  expect(response.status).toBe(200);
  const body=await response.json();
  expect(body.data).toHaveLength(1);
  expect(JSON.stringify(body)).not.toContain("/app/uploads");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
 });
 it("returns 404 when booking does not belong to the requesting account",async()=>{
  db.booking=false;
  expect((await route(request(),{accountId:account,role:"owner"})).status).toBe(404);
  expect(db.queries).toHaveLength(1);
 });
 it("rejects malformed booking identifiers without touching the DB",async()=>{
  expect((await route(request("../etc"),{accountId:account,role:"owner"})).status).toBe(404);
  expect(db.queries).toHaveLength(0);
 });
 it("constrains booking lookup and media listing to the session account",async()=>{
  await route(request(),{accountId:account,role:"admin"});
  expect(db.queries).toHaveLength(2);
  expect(db.queries.every(q=>q.params[1]===account)).toBe(true);
  expect(db.queries[0].sql).toMatch(/account_id = \$2/);
  expect(db.queries[1].sql).toMatch(/booking_request_id = \$1 AND account_id = \$2/);
 });
});
