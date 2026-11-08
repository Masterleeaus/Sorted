import test from "node:test";
import assert from "node:assert/strict";
import { negotiateTitanMcpHost, TITAN_MCP_HOST_CONTRACT } from "../.test-dist/index.js";

test("MCP host negotiation is intersection-only and authority-neutral", () => {
  const result=negotiateTitanMcpHost({
    host_id:"generic-host",
    company_id:"company-a",
    requested:{tools:true,resources:true,write_operations:true,embedded_ui:true},
    supported:{tools:true,resources:false,write_operations:false,embedded_ui:true},
  });
  assert.equal(result.company_id,"company-a");
  assert.equal(result.negotiated.tools,true);
  assert.equal(result.negotiated.resources,false);
  assert.equal(result.negotiated.write_operations,false);
  assert.equal(result.negotiated.embedded_ui,true);
  assert.equal(result.authority_neutral,true);
  assert.equal(result.grants_authority,false);
  assert.equal(TITAN_MCP_HOST_CONTRACT.negotiation_grants_authority,false);
});

test("MCP host negotiation requires canonical company scope", () => {
  assert.throws(()=>negotiateTitanMcpHost({host_id:"host",company_id:" "}),/company_id-required/);
});
