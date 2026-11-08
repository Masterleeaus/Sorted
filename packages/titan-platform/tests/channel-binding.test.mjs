import assert from "node:assert/strict";
import test from "node:test";
import { createConnectorCredentialReference } from "../.test-dist/ported/titan-connect/credential-contract.js";
import { resolveWebhookCompany, validateChannelBinding } from "../.test-dist/ported/titan-connect/channel-binding.js";
const credential = createConnectorCredentialReference({ company_id: "company-a", credential_ref: "cred-instagram-a", provider: "instagram" });
const binding = { company_id: "company-a", binding_id: "binding-1", kind: "instagram_dm", endpoint_ref: "instagram-page-a", credential, capabilities: ["message.receive", "message.send"], webhook_provenance: "signature-profile-a", active: true };
test("keeps channel credentials opaque and company-bound", () => { assert.doesNotThrow(() => validateChannelBinding(binding, "message.receive")); assert.equal(resolveWebhookCompany([binding], "instagram-page-a", "signature-profile-a"), "company-a"); });
test("fails closed for capability and ambiguous webhook routing", () => { assert.throws(() => validateChannelBinding(binding, "billing.write"), /capability/); assert.throws(() => resolveWebhookCompany([binding, { ...binding, binding_id: "binding-2", company_id: "company-b" }], "instagram-page-a", "signature-profile-a"), /ambiguous/); });

