import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RETRIEVER_NATIVE_DEFAULT_CAPABILITIES,
  RETRIEVER_DONOR_REFERENCE_POLICY,
  buildRetrieverSemanticRetirementLedger,
  evaluateRetrieverSemanticRetirement,
} from '../.test-dist/retriever/index.js';

const baseEvidence=()=>({
  native_protocol:'titan.retriever.native',
  native_version:'1.0',
  native_capabilities:[...RETRIEVER_NATIVE_DEFAULT_CAPABILITIES],
  lifecycle_paths:['work_submission','progress_observation','result_delivery','timeout','cancellation'],
  surface_paths:['chat','workflow','side-panel-compatible'],
  recovery_paths:['checkpoint','restore','restart','reconnect','stale_session'],
  company_boundary:'company_id',
  identity_grants_authority:false,
  live_donor_reference_count:0,
  live_donor_import_count:0,
  protected_hashes_present:true,
  pass8_regressions_complete:false,
});

test('semantic retirement ignores donor byte equality as an authorization gate',()=>{
  const a=evaluateRetrieverSemanticRetirement({...baseEvidence(),donor_hash_matches:true});
  const b=evaluateRetrieverSemanticRetirement({...baseEvidence(),donor_hash_matches:false});
  assert.equal(a.semantic_contracts_satisfied,true);
  assert.equal(b.semantic_contracts_satisfied,true);
  assert.equal(a.hash_match_required,false);
  assert.equal(b.hash_match_required,false);
  assert.equal(a.physical_removal_allowed,false);
  assert.equal(b.physical_removal_allowed,false);
});

test('zero live donor reachability is required for semantic retirement',()=>{
  const result=evaluateRetrieverSemanticRetirement({...baseEvidence(),live_donor_import_count:1});
  assert.equal(result.semantic_contracts_satisfied,false);
  assert.ok(result.blockers.includes('LIVE_DONOR_IMPORTS_REMAIN'));
});

test('company boundary and identity-not-authority are mandatory semantic contracts',()=>{
  const company=evaluateRetrieverSemanticRetirement({...baseEvidence(),company_boundary:'tenant_id'});
  assert.ok(company.blockers.includes('NONCANONICAL_COMPANY_BOUNDARY'));
  const authority=evaluateRetrieverSemanticRetirement({...baseEvidence(),identity_grants_authority:true});
  assert.ok(authority.blockers.includes('IDENTITY_AUTHORITY_VIOLATION'));
});

test('native lifecycle, surface, and recovery parity are independently required',()=>{
  const lifecycle=evaluateRetrieverSemanticRetirement({...baseEvidence(),lifecycle_paths:['work_submission']});
  assert.ok(lifecycle.blockers.includes('LIFECYCLE_PARITY_INCOMPLETE'));
  const surface=evaluateRetrieverSemanticRetirement({...baseEvidence(),surface_paths:['chat']});
  assert.ok(surface.blockers.includes('SURFACE_PARITY_INCOMPLETE'));
  const recovery=evaluateRetrieverSemanticRetirement({...baseEvidence(),recovery_paths:['checkpoint']});
  assert.ok(recovery.blockers.includes('RECOVERY_PARITY_INCOMPLETE'));
});

test('ledger retains protected hashes as provenance and defers deletion until Pass 8 regression gate',()=>{
  const ledger=buildRetrieverSemanticRetirementLedger({
    ...baseEvidence(),
    protected_hash_provenance:{
      path:'src/ported/titan-regression/monica-retriever/PROTECTED-RUNTIME-HASHES.json',
      retriever_background_sha256:'080267be826d81fc9ff1061b24fc2ee92cff37fe4d08dfe5d6d5eba2f2d14ce9',
    },
  });
  assert.equal(ledger.evidence_model,'semantic_contracts');
  assert.equal(ledger.protected_hash_policy,'PROVENANCE_ONLY_NOT_AUTHORIZATION');
  assert.equal(ledger.semantic_contracts_satisfied,true);
  assert.equal(ledger.pass8_regressions_complete,false);
  assert.equal(ledger.physical_removal_allowed,false);
  assert.equal(ledger.next_gate,'PASS8_REGRESSION_CERTIFICATION');
  assert.equal(RETRIEVER_DONOR_REFERENCE_POLICY.donor_file_removal_requires_pass9_gate,true);
});

test('after semantic contracts and Pass 8 certification, ledger may become Pass 9 removal eligible',()=>{
  const ledger=buildRetrieverSemanticRetirementLedger({...baseEvidence(),pass8_regressions_complete:true});
  assert.equal(ledger.semantic_contracts_satisfied,true);
  assert.equal(ledger.physical_removal_allowed,true);
  assert.equal(ledger.next_gate,'PASS9_ZERO_REFERENCE_AND_ROLLBACK_GATE');
});
