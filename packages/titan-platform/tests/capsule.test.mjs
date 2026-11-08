import assert from "node:assert/strict";
import test from "node:test";
import { capsuleDigest, validateCapsule } from "../.test-dist/recovery/capsule.js";
const payload = { evidence: ["e1"], projections: { jobs: "v2", workforce: "v1" } };
const manifest = { capsule_id: "cap-1", format_version: "1.0", company_id: "company-a", created_at: "2026-09-29T00:00:00.000Z", evidence_cursor: "e1", schema_versions: { jobs: "v2" }, constitution_versions: ["titan.constitution.v1"], provider_bindings: [{ provider: "native", site_ref: "site-a", credential_ref: "cred-ref-1", backup_digest: "backup-1" }], encrypted_secret_refs: ["secret-ref-1"], payload_digest: capsuleDigest(payload), mode: "recovery" };
test("accepts a deterministic, company-bound capsule", () => assert.doesNotThrow(() => validateCapsule(manifest, payload)));
test("rejects tampering, unsupported format, and production clone ambiguity", () => { assert.throws(() => validateCapsule({ ...manifest, payload_digest: "bad" }, payload), /integrity/); assert.throws(() => validateCapsule({ ...manifest, format_version: "0.9" }, payload), /format/); assert.throws(() => validateCapsule({ ...manifest, mode: "clone" }, payload), /namespace/); });

