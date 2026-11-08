import test from "node:test";
import assert from "node:assert/strict";
import { createTitanCapsuleManifest, validateTitanCapsule } from "../.test-dist/titan-capsule.js";
const input={capsule_id:"cap-1",company_id:"co-1",source_revision:"abc",constitution_version:"c1",runtime_version:"r1",provider_refs:["provider:1"],encrypted_secret_refs:["secret:1"],content_checksums:{evidence:"hash-e",config:"hash-c"},created_at:"2026-02-01T00:00:00Z"};
test("creates and validates a company-bound capsule",()=>{const m=createTitanCapsuleManifest(input); assert.equal(validateTitanCapsule(m,{company_id:"co-1",runtime_version:"r1",constitution_version:"c1",available_checksums:input.content_checksums}).valid,true);});
test("rejects mismatch and checksum tampering",()=>{const m=createTitanCapsuleManifest(input); assert.equal(validateTitanCapsule(m,{company_id:"co-2",runtime_version:"r1",constitution_version:"c1",available_checksums:input.content_checksums}).reason,"company-mismatch"); assert.equal(validateTitanCapsule(m,{company_id:"co-1",runtime_version:"r1",constitution_version:"c1",available_checksums:{...input.content_checksums,evidence:"bad"}}).reason,"checksum-mismatch");});
test("rejects revoked secret references",()=>{const m=createTitanCapsuleManifest(input); assert.equal(validateTitanCapsule(m,{company_id:"co-1",runtime_version:"r1",constitution_version:"c1",available_checksums:input.content_checksums,revoked_secret_refs:["secret:1"]}).reason,"secret-revoked");});

