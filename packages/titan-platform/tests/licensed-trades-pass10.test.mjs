import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLicensedTradesE2eCertification,
  LICENSED_TRADES_REFERENCE_BLUEPRINT,
  LICENSED_TRADES_E2E_CERTIFICATION_SCHEMA,
  LICENSED_TRADES_VERTICAL_CAPABILITY_MATRIX
} from '../.licensed-trades-test-dist/certification.js';

const refs={lead:'lead-1',triage:'triage-1',quote:'quote-1',booking:'booking-1',assignment:'assignment-1',job:'job-1',evidence:'evidence-1',invoice:'invoice-1',payment:'payment-1',rebooking:'rebooking-1'};
const base={company_id:'co-1',trade:'electrical',service_key:'electrical.installation.circuit-equipment',refs,qualification:{required_tags:['electrical_licensed_worker_required'],verified_tags:['electrical_licensed_worker_required'],evidence_refs:['licence:1']},permissions:{quote:true,booking:true,assignment:true,job_execution:true},stage_company_ids:{}};

test('Pass10 certifies a complete licensed-trade lifecycle as projection only',()=>{const r=buildLicensedTradesE2eCertification(base);assert.equal(r.schema,LICENSED_TRADES_E2E_CERTIFICATION_SCHEMA);assert.equal(r.certified,true);assert.deepEqual(r.blockers,[]);assert.equal(r.execution_permitted,false);assert.equal(r.grants_authority,false);});

test('reference blueprint covers governed lead through rebooking owners',()=>{const ids=LICENSED_TRADES_REFERENCE_BLUEPRINT.stages.map(s=>s.id);assert.deepEqual(ids,['lead_intake','triage','quote','booking','qualification','workforce_assignment','job_execution','evidence','invoice','payment','rebooking']);assert.equal(LICENSED_TRADES_REFERENCE_BLUEPRINT.owner_transfer_permitted,false);});

test('missing qualification evidence fails closed before assignment or execution',()=>{const r=buildLicensedTradesE2eCertification({...base,qualification:{required_tags:['electrical_licensed_worker_required'],verified_tags:[],evidence_refs:[]}});assert.equal(r.certified,false);assert.ok(r.blockers.includes('QUALIFICATION_TAG_UNVERIFIED:electrical_licensed_worker_required'));assert.ok(r.blockers.includes('QUALIFICATION_EVIDENCE_REQUIRED'));assert.equal(r.assignment_mutation_emitted,false);});

test('permissions cannot be bypassed by vertical identity or workflow state',()=>{const r=buildLicensedTradesE2eCertification({...base,permissions:{quote:true,booking:true,assignment:false,job_execution:false}});assert.equal(r.certified,false);assert.ok(r.blockers.includes('PERMISSION_REQUIRED:assignment'));assert.ok(r.blockers.includes('PERMISSION_REQUIRED:job_execution'));assert.equal(r.identity_grants_authority,false);});

test('cross-company stage references fail closed',()=>{const r=buildLicensedTradesE2eCertification({...base,stage_company_ids:{job_execution:'co-2'}});assert.equal(r.certified,false);assert.ok(r.blockers.includes('CROSS_COMPANY:job_execution'));});

test('plumbing electrical and HVAC capability matrix stays isolated from Cleaning/Handyman semantics',()=>{assert.deepEqual(LICENSED_TRADES_VERTICAL_CAPABILITY_MATRIX.map(x=>x.trade),['plumbing','electrical','hvac']);for(const row of LICENSED_TRADES_VERTICAL_CAPABILITY_MATRIX){assert.equal(row.company_boundary,'company_id');assert.equal(row.automatic_assignment_permitted,false);assert.equal(row.permission_bypass_permitted,false);assert.equal(row.qualification_bypass_permitted,false);assert.equal(row.handyman_semantics_inherited,false);assert.equal(row.cleaning_semantics_inherited,false);}});

test('all three trades can certify with matching qualification evidence',()=>{for(const [trade,service,tag] of [['plumbing','plumbing.installation.fixture-system','plumbing_licensed_worker_required'],['electrical','electrical.installation.circuit-equipment','electrical_licensed_worker_required'],['hvac','hvac.installation.system','hvac_installation_scope,configured_refrigerant_or_electrical_qualification_when_required']]){const r=buildLicensedTradesE2eCertification({...base,trade,service_key:service,qualification:{required_tags:String(tag).split(','),verified_tags:String(tag).split(','),evidence_refs:[`${trade}:licence`]}});assert.equal(r.certified,true,`${trade}:${r.blockers.join(',')}`);}});

test('legacy tenant aliases are rejected',()=>{assert.throws(()=>buildLicensedTradesE2eCertification({...base,tenant_id:'legacy'}),/legacy tenant boundary/);});

test('missing lifecycle refs block certification',()=>{const r=buildLicensedTradesE2eCertification({...base,refs:{...refs,payment:undefined}});assert.equal(r.certified,false);assert.ok(r.blockers.includes('MISSING_PAYMENT_REF'));});

test('certification never mutates shared quote booking assignment job payment or rebooking owners',()=>{const r=buildLicensedTradesE2eCertification(base);assert.equal(r.quote_mutation_emitted,false);assert.equal(r.booking_mutation_emitted,false);assert.equal(r.assignment_mutation_emitted,false);assert.equal(r.job_mutation_emitted,false);assert.equal(r.payment_mutation_emitted,false);assert.equal(r.rebooking_action_emitted,false);});
