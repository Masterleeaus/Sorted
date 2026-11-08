import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTeamAAnalysis } from '../core/intelligence-team-a.mjs';
import { createTeamBAnalysis } from '../core/intelligence-team-b.mjs';
import { assessConvergence } from '../core/convergence-intelligence.mjs';
const manifest=JSON.parse(await readFile(new URL('../../manifest.json',import.meta.url),'utf8'));
const evidence=(id,domain)=>[{evidence_id:id,kind:'observation',source:id,claim:'verified customer booking accepted and ready for service',confidence:.9,provenance:{independence_domain:domain}}];
async function pair(domainA='source:a',domainB='source:b',bText='customer booking is verified accepted and ready for service'){
 const a=await createTeamAAnalysis({company_id:'c1',item_id:'i1',revision_id:'r1',lens:'meaning-context',evidence:evidence('a',domainA),interpretation:'customer booking is verified accepted and ready for service',confidence:.88});
 const b=await createTeamBAnalysis({company_id:'c1',item_id:'i1',revision_id:'r1',lens:'provenance-reality',evidence:evidence('b',domainB),interpretation:bText,confidence:.82});
 return {a,b};
}
test('pass 13 increments BOS package version',()=>assert.equal(manifest.version,'0.18.2'));
test('independently reached agreement is confidence evidence',async()=>{const {a,b}=await pair();const r=await assessConvergence({team_a:a,team_b:b});assert.equal(r.classification,'independent-convergence');assert.equal(r.independently_reached,true);assert.ok(r.confidence_evidence.strength>0);assert.equal(r.confidence_evidence.aggregation,'not-averaged');});
test('shared dependency makes agreement correlated rather than independent',async()=>{const {a,b}=await pair('shared:x','shared:x');const r=await assessConvergence({team_a:a,team_b:b});assert.equal(r.classification,'correlated-convergence');assert.equal(r.independently_reached,false);assert.equal(r.confidence_evidence.strength,0);assert.deepEqual(r.independence.shared_domains,['shared:x']);});
test('different conclusions produce no convergence',async()=>{const {a,b}=await pair('a','b','invoice appears forged and should be held for investigation');const r=await assessConvergence({team_a:a,team_b:b});assert.equal(r.classification,'no-convergence');assert.equal(r.agreement_detected,false);});
test('comparison requires same company item and exact revision',async()=>{const {a,b}=await pair();const altered=structuredClone(b);altered.revision_id='r2';await assert.rejects(()=>assessConvergence({team_a:a,team_b:altered}),/convergence-revision-id-mismatch/);});
test('invalid seals cannot enter convergence',async()=>{const {a,b}=await pair();const altered=structuredClone(b);altered.interpretation+=' tampered';await assert.rejects(()=>assessConvergence({team_a:a,team_b:altered}),/team-b-seal-invalid/);});
