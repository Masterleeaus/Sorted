import test from "node:test";import assert from "node:assert/strict";import {projectMcpTool,createMcpReceipt} from "../.test-dist/mcp-projection.js";
const tool={tool_id:"t1",host_id:"chatgpt",company_id:"co1",capability_id:"quote.create",input_schema:"schema:v1",consent_required:true,enabled:true};
test("maps MCP host tools to canonical capabilities with authority-neutral receipts",()=>{const r=createMcpReceipt(projectMcpTool(tool),"co1","req:1",true,"ACCEPTED");assert.equal(r.capability_id,"quote.create");assert.equal(r.authorityGranted,false)});
test("rejects cross-company, disabled and unconsented MCP calls",()=>{assert.throws(()=>createMcpReceipt(tool,"co2","r",true,"ACCEPTED"),/company/);assert.throws(()=>createMcpReceipt({...tool,enabled:false},"co1","r",true,"ACCEPTED"),/disabled/);assert.throws(()=>createMcpReceipt(tool,"co1","r",false,"ACCEPTED"),/consent/)})

