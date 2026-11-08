import test from "node:test";
import assert from "node:assert/strict";
import { enrollEdgeNode, selectEdgeNode, issueEdgeLease, revalidateEdgeReconnect } from "../.test-dist/edge-fabric.js";

const node = (id, load=0.2) => enrollEdgeNode({company_id:"co-1",node_id:id,locality:"edge",capabilities:["dispatch"],healthy:true,load,last_seen:"2026-02-01T00:00:00Z"});
test("selects company-bound capable node deterministically",()=>{assert.equal(selectEdgeNode([node("b",.2),node("a",.2),node("x",.1)],{company_id:"co-1",capability:"dispatch"}).node_id,"x"); assert.throws(()=>selectEdgeNode([node("a")],{company_id:"co-2",capability:"dispatch"}),/no-authorized-edge-node/);});
test("lease reconnect requires current authority revision",()=>{const n=node("a"); const l=issueEdgeLease(n,{work_id:"w",lease_id:"l",authority_revision:"r1",now:"2026-02-01T00:00:00Z",ttl_ms:60000}); assert.equal(revalidateEdgeReconnect(l,{company_id:"co-1",node:n,now:"2026-02-01T00:00:30Z",authority_revision:"r1"}).accepted,true); assert.equal(revalidateEdgeReconnect(l,{company_id:"co-1",node:n,now:"2026-02-01T00:00:30Z",authority_revision:"r2"}).reason,"authority-revalidation-required");});
test("expired or revoked leases fail closed",()=>{const n=node("a"); const l=issueEdgeLease(n,{work_id:"w",lease_id:"l",authority_revision:"r1",now:"2026-02-01T00:00:00Z",ttl_ms:1000}); assert.equal(revalidateEdgeReconnect(l,{company_id:"co-1",node:n,now:"2026-02-01T00:00:02Z",authority_revision:"r1"}).reason,"lease-expired");});

