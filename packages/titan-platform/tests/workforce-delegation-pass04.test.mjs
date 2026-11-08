import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimTitanDelegationLease,
  heartbeatTitanDelegationLease,
  inspectTitanDelegationLease,
  recoverTitanDelegationLease,
  releaseTitanDelegationLease,
} from '../.test-dist/workforce-delegation/index.js';

const envelope = {
  company_id:'co-1', delegation_id:'d-4', objective:'dispatch task', authority_ceiling:'WRITE_INTERNAL',
  idempotency_key:'idem-4', causality:{correlation_id:'corr-4'}, expected_outcome:{description:'task dispatched'}
};
const t0='2026-09-13T00:00:00.000Z';

test('claim is idempotent for the same claimant and blocks competing live claims',()=>{
  const lease=claimTitanDelegationLease({envelope,claimant_id:'worker-a',claimant_tier:'WORKER',now:t0,ttl_ms:60000});
  const retry=claimTitanDelegationLease({envelope,claimant_id:'worker-a',claimant_tier:'WORKER',now:'2026-09-13T00:00:10Z',ttl_ms:60000,existing_lease:lease});
  assert.equal(retry.lease_token,lease.lease_token);
  assert.equal(retry.generation,1);
  assert.throws(()=>claimTitanDelegationLease({envelope,claimant_id:'worker-b',claimant_tier:'WORKER',now:'2026-09-13T00:00:10Z',existing_lease:lease}),/lease-held/);
});

test('heartbeat requires current claimant and lease token',()=>{
  const lease=claimTitanDelegationLease({envelope,claimant_id:'worker-a',claimant_tier:'WORKER',now:t0,ttl_ms:60000});
  assert.throws(()=>heartbeatTitanDelegationLease({lease,claimant_id:'worker-b',lease_token:lease.lease_token,now:'2026-09-13T00:00:10Z'}),/claimant-mismatch/);
  assert.throws(()=>heartbeatTitanDelegationLease({lease,claimant_id:'worker-a',lease_token:'stale',now:'2026-09-13T00:00:10Z'}),/token-mismatch/);
  const beat=heartbeatTitanDelegationLease({lease,claimant_id:'worker-a',lease_token:lease.lease_token,now:'2026-09-13T00:00:10Z',ttl_ms:120000});
  assert.equal(beat.heartbeat_at,'2026-09-13T00:00:10.000Z');
  assert.equal(beat.lease_until,'2026-09-13T00:02:10.000Z');
});

test('expired lease is restart-recoverable with new generation and stale token cannot heartbeat',()=>{
  const old=claimTitanDelegationLease({envelope,claimant_id:'worker-a',claimant_tier:'WORKER',now:t0,ttl_ms:5000});
  const status=inspectTitanDelegationLease(old,'2026-09-13T00:00:06Z');
  assert.equal(status.state,'EXPIRED'); assert.equal(status.recoverable,true);
  assert.throws(()=>heartbeatTitanDelegationLease({lease:old,claimant_id:'worker-a',lease_token:old.lease_token,now:'2026-09-13T00:00:06Z'}),/not-active:EXPIRED/);
  const recovered=recoverTitanDelegationLease({envelope,expired_lease:old,claimant_id:'worker-b',claimant_tier:'WORKER',now:'2026-09-13T00:00:06Z',ttl_ms:60000});
  assert.equal(recovered.generation,2); assert.notEqual(recovered.lease_token,old.lease_token); assert.equal(recovered.claimant_id,'worker-b');
});

test('release is idempotent and prevents heartbeat',()=>{
  const lease=claimTitanDelegationLease({envelope,claimant_id:'worker-a',claimant_tier:'WORKER',now:t0,ttl_ms:60000});
  const released=releaseTitanDelegationLease({lease,claimant_id:'worker-a',lease_token:lease.lease_token,now:'2026-09-13T00:00:20Z'});
  const again=releaseTitanDelegationLease({lease:released,claimant_id:'worker-a',lease_token:lease.lease_token,now:'2026-09-13T00:00:30Z'});
  assert.equal(again.released_at,released.released_at); assert.equal(again.state,'RELEASED');
  assert.throws(()=>heartbeatTitanDelegationLease({lease:released,claimant_id:'worker-a',lease_token:lease.lease_token,now:'2026-09-13T00:00:21Z'}),/not-active:RELEASED/);
});

test('lease claim preserves company and idempotency binding and grants no authority',()=>{
  const lease=claimTitanDelegationLease({envelope,claimant_id:'worker-a',claimant_tier:'WORKER',now:t0});
  assert.equal(lease.company_id,'co-1'); assert.equal(lease.idempotency_key,'idem-4');
  assert.equal(lease.grants_authority,false); assert.equal(lease.authority_effect,false); assert.equal(lease.execution_permitted,false);
  assert.throws(()=>claimTitanDelegationLease({envelope:{...envelope,company_id:'co-2'},claimant_id:'worker-a',claimant_tier:'WORKER',now:'2026-09-13T00:00:10Z',existing_lease:lease}),/company-mismatch/);
});
