import test from "node:test";
import assert from "node:assert/strict";
import { createConnectorCredentialReference } from "../.test-dist/index.js";

test("credential contracts contain only opaque company-scoped references",()=>{
  const ref=createConnectorCredentialReference({company_id:"c1",credential_ref:"cred:abc123",provider:"OpenAI"});
  assert.equal(ref.company_id,"c1");
  assert.equal(ref.provider,"openai");
  assert.equal(ref.credential_ref,"cred:abc123");
  assert.equal(ref.secret_material_exposed,false);
});

test("credential references reject missing company or material-like newline values",()=>{
  assert.throws(()=>createConnectorCredentialReference({company_id:"",credential_ref:"x",provider:"openai"}),/company_id-required/);
  assert.throws(()=>createConnectorCredentialReference({company_id:"c1",credential_ref:"x\nsecret",provider:"openai"}),/invalid-credential-ref/);
});
