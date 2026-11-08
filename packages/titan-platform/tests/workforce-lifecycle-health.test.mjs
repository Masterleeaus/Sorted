import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITAN_WORKFORCE_HEALTH_CONTRACT,
  declareTitanWorkforceAgent,
  evaluateTitanWorkforceAssignmentCompatibility,
  projectTitanWorkforceHealth,
} from '../.lifecycle-test-dist/workforce-lifecycle/index.js';

const registration=()=>declareTitanWorkforceAgent({
 company_id:'company-1',agent_key:'booking',agent_version:'1.0.0',name:'Booking Agent',
 role_definition_id:'titan.customer.booking_coordinator',operational_domains:['booking','crm'],
 capabilities:[{capability_id:'booking.prepare',version:'1.2.0',description:'',operations:['read','propose']}],configuration:{}
});
const health=(overrides={})=>projectTitanWorkforceHealth({company_id:'company-1',agent_key:'booking',lifecycle_state:'ENABLED',health_state:'READY',...overrides});

test('health contract requires ENABLED + READY and grants no authority',()=>{
 assert.equal(TITAN_WORKFORCE_HEALTH_CONTRACT.assignableRequiresLifecycle,'ENABLED');
 assert.equal(TITAN_WORKFORCE_HEALTH_CONTRACT.assignableRequiresHealth,'READY');
 const h=health(); assert.equal(h.accepts_new_assignments,true); assert.equal(h.grants_authority,false);
});

test('degraded and unavailable agents reject new assignment',()=>{
 assert.equal(health({health_state:'DEGRADED',readiness_reasons:['provider-down']}).accepts_new_assignments,false);
 assert.equal(health({health_state:'UNAVAILABLE',readiness_reasons:['offline']}).accepts_new_assignments,false);
});

test('paused, draining, disabled and registered agents reject new assignment even when healthy',()=>{
 for(const lifecycle_state of ['PAUSED','DRAINING','DISABLED','REGISTERED']) assert.equal(health({lifecycle_state}).accepts_new_assignments,false);
});

test('READY health cannot hide blocking readiness reasons',()=>{
 assert.throws(()=>health({readiness_reasons:['provider-down']}),/ready-health-cannot-have-blocking-reasons/);
});

test('compatible capability and domain yields assignable recommendation only',()=>{
 const result=evaluateTitanWorkforceAssignmentCompatibility({company_id:'company-1',registration:registration(),health:health(),required_capabilities:[{capability_id:'booking.prepare',min_version:'1.1.0'}],required_domains:['booking']});
 assert.equal(result.compatible,true); assert.equal(result.assignable,true); assert.equal(result.assignment_permitted,false); assert.equal(result.grants_authority,false);
});

test('missing or old capabilities and missing domains fail closed',()=>{
 let result=evaluateTitanWorkforceAssignmentCompatibility({company_id:'company-1',registration:registration(),health:health(),required_capabilities:[{capability_id:'booking.confirm'}]});
 assert.equal(result.assignable,false); assert.deepEqual(result.missing_capabilities,['booking.confirm']);
 result=evaluateTitanWorkforceAssignmentCompatibility({company_id:'company-1',registration:registration(),health:health(),required_capabilities:[{capability_id:'booking.prepare',min_version:'2.0.0'}],required_domains:['dispatch']});
 assert.equal(result.assignable,false); assert.equal(result.incompatible_capabilities.length,1); assert.deepEqual(result.missing_domains,['dispatch']);
});

test('health state prevents assignment even when capability compatibility passes',()=>{
 const result=evaluateTitanWorkforceAssignmentCompatibility({company_id:'company-1',registration:registration(),health:health({health_state:'DEGRADED',readiness_reasons:['latency']}),required_domains:['booking']});
 assert.equal(result.compatible,true); assert.equal(result.assignable,false); assert.match(result.reasons[0],/not-assignable/);
});

test('cross-company and agent mismatch fail closed',()=>{
 assert.throws(()=>evaluateTitanWorkforceAssignmentCompatibility({company_id:'company-2',registration:registration(),health:health()}),/cross-company/);
 const wrong=projectTitanWorkforceHealth({company_id:'company-1',agent_key:'sales',lifecycle_state:'ENABLED',health_state:'READY'});
 assert.throws(()=>evaluateTitanWorkforceAssignmentCompatibility({company_id:'company-1',registration:registration(),health:wrong}),/agent-mismatch/);
});
