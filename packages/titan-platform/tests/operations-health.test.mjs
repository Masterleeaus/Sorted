import test from "node:test";
import assert from "node:assert/strict";
import { createOperationsHealth, assertOperationsHealthCompany } from "../.test-dist/operations-health.js";
const input={company_id:"co-1",observed_at:"2026-02-01T00:00:00Z",nodes:[{node_id:"n1",status:"online",last_seen:"2026-02-01T00:00:00Z",drift:"none",backup:"current"},{node_id:"n2",status:"degraded",last_seen:"2026-01-31T00:00:00Z",drift:"detected",backup:"stale"}]};
test("projects health and remediation without granting execution",()=>{const h=createOperationsHealth(input); assert.equal(h.nodes.length,2); assert.deepEqual(h.remediations.map(x=>x.remediation_id),["n2:reconnect","n2:reconcile","n2:backup"]); assert.equal(h.remediations[0].requires_governed_execution,true);});
test("enforces company scope and unique nodes",()=>{const h=createOperationsHealth(input); assert.equal(assertOperationsHealthCompany(h,"co-1"),true); assert.throws(()=>assertOperationsHealthCompany(h,"co-2"),/company-mismatch/); assert.throws(()=>createOperationsHealth({...input,nodes:[input.nodes[0],input.nodes[0]]}),/node-id-duplicate/);});
test("rejects malformed observation",()=>assert.throws(()=>createOperationsHealth({...input,observed_at:"bad"}),/observed_at-invalid/));

