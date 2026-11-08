import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildEvidenceIndependence, compareEvidenceIndependence, CONTRIBUTOR_TYPES } from '../core/evidence-independence.mjs';
import { createTeamAAnalysis } from '../core/intelligence-team-a.mjs';
import { createTeamBAnalysis } from '../core/intelligence-team-b.mjs';
const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
const ev=[{evidence_id:'obs1',kind:'observation',source:'browser-event-ledger',claim:'observed',confidence:.9,provenance:{independence_domain:'browser:event:42'}}];
test('pass 12 increments BOS package version',()=>assert.equal(manifest.version,'0.18.2'));
test('canonical contributor classes include source memory rule model observation',()=>assert.deepEqual(CONTRIBUTOR_TYPES,['source','memory','rule','model','observation']));
test('tracker records explicit and evidence-derived contributors with exact revision',()=>{
 const x=buildEvidenceIndependence({contributors:[
  {type:'memory',id:'mem-1',origin:'local-memory',independence_domain:'memory:mem-1'},
  {type:'rule',id:'rule-7',origin:'booking-policy-v7'},
  {type:'model',id:'local-model-1',origin:'ollama:qwen',independence_domain:'model:ollama-local'}
 ]},ev,'A','r1');
 assert.equal(x.revision_id,'r1'); assert.equal(x.contributor_count,4); assert.deepEqual(x.by_type.memory,['mem-1']); assert.deepEqual(x.by_type.rule,['rule-7']); assert.deepEqual(x.by_type.model,['local-model-1']); assert.deepEqual(x.by_type.observation,['evidence:obs1']);
});
test('correlated dependencies are marked rather than counted as independent',()=>{
 const x=buildEvidenceIndependence({contributors:[{type:'source',id:'s1',origin:'api-a',independence_domain:'upstream:x'},{type:'memory',id:'m1',origin:'cache-a',independence_domain:'upstream:x'}]},[],'A','r1');
 assert.equal(x.has_potential_correlation,true); assert.equal(x.correlated_domains[0].independence_domain,'upstream:x');
});
test('cross-assessment comparison exposes shared dependency domains without averaging confidence',()=>{
 const a=buildEvidenceIndependence({contributors:[{type:'source',id:'a',origin:'x',independence_domain:'shared:x'}]},[],'A','r1');
 const b=buildEvidenceIndependence({contributors:[{type:'source',id:'b',origin:'x',independence_domain:'shared:x'}]},[],'B','r1');
 const c=compareEvidenceIndependence(a,b); assert.deepEqual(c.shared_domains,['shared:x']); assert.equal(c.has_shared_dependencies,true); assert.equal('confidence' in c,false);
});
test('Team A seal contains evidence-independence ledger',async()=>{
 const a=await createTeamAAnalysis({company_id:'c1',item_id:'i1',revision_id:'r1',lens:'meaning-context',evidence:ev,interpretation:'meaning',confidence:.8,contributors:[{type:'memory',id:'m1',origin:'local'}]});
 assert.equal(a.evidence_independence.team,'A'); assert.ok(a.evidence_independence.by_type.memory.includes('m1'));
});
test('Team B seal contains its own ledger and rejects Team A contributor provenance',async()=>{
 const base={company_id:'c1',item_id:'i1',revision_id:'r1',lens:'provenance-reality',evidence:ev,interpretation:'real',confidence:.8};
 const b=await createTeamBAnalysis({...base,contributors:[{type:'rule',id:'r1',origin:'local-rule'}]}); assert.equal(b.evidence_independence.team,'B');
 await assert.rejects(()=>createTeamBAnalysis({...base,contributors:[{type:'source',id:'team-a-result',origin:'team-a'}]}),/team-b-independence-contaminated/);
});
