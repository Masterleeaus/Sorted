import test from "node:test";
import assert from "node:assert/strict";
import { createFoundryArtifact, verifyFoundryArtifact, assertFoundryRollback } from "../.test-dist/foundry-artifact.js";
const base={artifact_id:"a1",company_id:"co-1",source_ref:"builder:site-1",source_hash:"source-1",artifact_hash:"artifact-1",version:1,created_at:"2026-02-01T00:00:00Z"};
test("verifies a preview artifact without making it a deployment authority",()=>{const a=createFoundryArtifact(base);const v=verifyFoundryArtifact(a,{company_id:"co-1",source_hash:"source-1",artifact_hash:"artifact-1"});assert.equal(v.state,"verified");});
test("requires provenance for publication and rejects tampering",()=>{assert.throws(()=>createFoundryArtifact({...base,state:"published"}),/provenance-required/);const a=createFoundryArtifact(base);assert.throws(()=>verifyFoundryArtifact(a,{company_id:"co-1",source_hash:"bad",artifact_hash:"artifact-1"}),/source-hash-mismatch/);});
test("accepts only the declared company-scoped published rollback target",()=>{const wrong=createFoundryArtifact({...base,artifact_id:"wrong",state:"published",deployment_ref:"deploy:old",rollback_artifact_id:"a0"});const next=createFoundryArtifact({...base,artifact_id:"a2",state:"published",deployment_ref:"deploy:new",rollback_artifact_id:"a1"});assert.throws(()=>assertFoundryRollback(next,wrong),/rollback-target-mismatch/);const target=createFoundryArtifact({...base,artifact_id:"a1",state:"published",deployment_ref:"deploy:target",rollback_artifact_id:"a0"});assert.equal(assertFoundryRollback(next,target),true);});

