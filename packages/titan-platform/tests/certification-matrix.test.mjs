import test from 'node:test';
import assert from 'node:assert/strict';
const modulePath = process.env.CERTIFICATION_SOURCE === '1' ? '../src/certification-matrix.ts' : '../.test-dist/certification-matrix.js';
const { evaluateReleaseEligibility } = await import(modulePath);

test('legacy empty coverage is denied rather than vacuously certified', () => {
  assert.equal(evaluateReleaseEligibility([]).eligible, false);
});
test('legacy mandatory skipped evidence is denied', () => {
  const result = evaluateReleaseEligibility([{cell_id:'isolation', mandatory:true, status:'SKIPPED', provenance_ref:null}]);
  assert.equal(result.eligible, false);
});

const { deriveCertificationCoverage } = await import(modulePath);
import { inputs } from './fixtures/certification-inputs.mjs';
const pass = (context=inputs()) => deriveCertificationCoverage(context).expected_cells.map(cell=>({cell_id:cell.cell_id,mandatory:true,status:'PASS',provenance_ref:'test:fixture-only',command:'node --test fixture.test.mjs',coverage_ref:'declared-inputs'}));
const evaluate = (cells, context=inputs(), binding=deriveCertificationCoverage(inputs()).coverage_key)=>evaluateReleaseEligibility({schema:'titan.certification-results/v1',coverage_key:binding,cells},context);

test('complete evidence-backed fixture passes and retains v1 lineage',()=>{
  const result=evaluate(pass());
  assert.equal(result.schema,'titan.release-eligibility/v1');
  assert.equal(result.eligible,true);
  assert.ok(result.expected_cells.length >= 9);
  assert.deepEqual(result.denial_reasons,[]);
  assert.equal(result.authorityGranted,false);
  assert.equal(result.publication_state,'NOT_EVALUATED');
});
test('coverage comes from independent canonical inputs, not result mandatory flags',()=>{
  const cells=pass(); const required=cells[0].cell_id;
  const omitted=evaluate(cells.slice(1));
  assert.equal(omitted.eligible,false);
  assert.ok(omitted.denial_reasons.includes(`missing-result:${required}`));
  cells[0].mandatory=false;
  assert.equal(evaluate(cells).eligible,false);
});
for (const status of ['FAIL','SKIPPED','NOT_RUN','NOT_APPLICABLE','UNKNOWN',null]) {
  test(`required ${status} cannot pass`,()=>{const cells=pass();cells[0].status=status;assert.equal(evaluate(cells).eligible,false)});
}
for (const provenance of [null,'','   ',4]) {
  test(`invalid provenance ${JSON.stringify(provenance)} fails`,()=>{const cells=pass();cells[0].provenance_ref=provenance;assert.equal(evaluate(cells).eligible,false)});
}
test('duplicate identical or conflicting results fail',()=>{
  for(const status of ['PASS','FAIL']) {const cells=pass();assert.equal(evaluate([...cells,{...cells[0],status}]).eligible,false)}
});
test('malformed result identities, status, command, binding and array fail closed',()=>{
  for(const delta of [{cell_id:''},{cell_id:' '},{mandatory:'true'},{command:''},{command:null},{coverage_ref:''},{status:'pass'}]) {
    const cells=pass();cells[0]={...cells[0],...delta};assert.equal(evaluate(cells).eligible,false);
  }
  for(const cells of [null,{},[null],[false]])assert.equal(evaluate(cells).eligible,false);
});
test('legacy positive evidence cannot claim independent coverage',()=>{
  assert.equal(evaluateReleaseEligibility([{cell_id:'x',mandatory:true,status:'PASS',provenance_ref:'test:old'}]).eligible,false);
});
test('empty, missing and malformed canonical coverage cannot pass',()=>{
  for(const mutate of [x=>x.registry.entries=[],x=>x.projections=[],x=>x.registry=null,x=>x.schema='wrong',x=>x.policy='wrong',x=>x.compatibility.schema='wrong',x=>x.compatibility.registry_version='unknown',x=>x.compatibility.source_revision='b'.repeat(40),x=>x.projections[0].contract_version='v0',x=>x.candidate_revision='',x=>x.artifact_hash='sha256:1',x=>x.registry.entries.push({...x.registry.entries[0]}),x=>x.projections.push({...x.projections[0]})]) {
    const context=inputs();mutate(context);assert.equal(evaluate(pass(),context).eligible,false);
  }
});
test('candidate, artifact, registry and scope changes invalidate old results',()=>{
  for(const mutate of [x=>{x.candidate_revision='c'.repeat(40);x.compatibility.source_revision=x.candidate_revision},x=>x.artifact_hash=`sha256:${'d'.repeat(64)}`,x=>x.registry_revision='e'.repeat(40),x=>x.scope_revision='f'.repeat(40),x=>x.registry.entries.push({registry_id:'titan.native:capability:other'}),x=>x.projections[0].platform_adapter='mobile']){
    const context=inputs();mutate(context);assert.equal(evaluate(pass(),context).eligible,false);
  }
});
test('advisory failures do not remove or expand required coverage',()=>{
  const result=evaluate([...pass(),{cell_id:'advisory:latency',mandatory:false,status:'FAIL',provenance_ref:'test:advisory',command:'node advisory.mjs',coverage_ref:'declared-inputs'}]);
  assert.equal(result.eligible,true);
  assert.equal(result.expected_cells.length,deriveCertificationCoverage(inputs()).expected_cells.length);
  assert.equal(evaluate([...pass(),{...pass()[0],cell_id:'invented-required'}]).eligible,false);
});
test('deterministic ordering and no input mutation',()=>{
  const context=inputs();context.projections.push({...context.projections[0],platform_adapter:'mobile'});
  context.registry.entries.push({registry_id:'titan.native:capability:quotes.read'});
  const cells=pass(context);const before=structuredClone({context,cells});
  const binding=deriveCertificationCoverage(context).coverage_key;const a=evaluate(cells,context,binding);
  const b=evaluate([...cells].reverse(),{...context,projections:[...context.projections].reverse(),registry:{...context.registry,entries:[...context.registry.entries].reverse()}},binding);
  assert.deepEqual(a,b);assert.deepEqual({context,cells},before);
});

test('shared input binding keeps representative 6300-projection evidence linear',()=>{
  const context=inputs();context.projections=Array.from({length:6300},(_,i)=>({...context.projections[0],platform_adapter:`adapter-${i}`}));
  const coverage=deriveCertificationCoverage(context);
  const cells=coverage.expected_cells.map(cell=>({cell_id:cell.cell_id,mandatory:true,status:'PASS',provenance_ref:'fixture:scale',command:'node fixture.mjs',coverage_ref:'declared-inputs'}));
  const result=evaluate(cells,context,coverage.coverage_key);
  assert.equal(result.eligible,true);assert.equal(result.expected_cells.length,56700);
  assert.ok(Buffer.byteLength(JSON.stringify(result))<64*1024*1024);
  assert.ok(cells.every(cell=>!('coverage_key' in cell)));
});

test('JSON object and array statuses return a denial without invoking coercion',()=>{
 for(const status of [{toString:null},[],{},['PASS']]){
  const cells=pass();cells[0].status=status;const result=evaluate(cells);
  assert.equal(result.eligible,false);assert.ok(result.denial_reasons.includes(`status-invalid:${cells[0].cell_id}`));
 }
});

test('unknown evidence schema and tampered shared binding deny complete results',()=>{
 const context=inputs();const coverage=deriveCertificationCoverage(context);
 for(const evidence of [
  {schema:'unknown/v1',coverage_key:coverage.coverage_key,cells:pass()},
  {schema:'titan.certification-results/v1',coverage_key:'tampered',cells:pass()},
  {schema:'titan.certification-results/v1',coverage_key:coverage.coverage_key,cells:[]},
 ])assert.equal(evaluateReleaseEligibility(evidence,context).eligible,false);
});
