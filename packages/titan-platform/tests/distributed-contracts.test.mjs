import test from 'node:test'; import assert from 'node:assert/strict';
import * as dist from '../.test-dist/distributed/index.js';
const {normalizeTitanSurface,requireCompanyId,assertSingleCanonicalOwner,offlineAuthorityFailure,assertIntelligenceNoImplicitTitanCost,rankPlacementCandidates,allowedLocalities,createRoutingReceipt,dataEgressForLocality}=dist;
test('canonical surfaces normalize aliases',()=>{assert.equal(normalizeTitanSurface('command'),'zero');assert.equal(normalizeTitanSurface('field'),'go');assert.equal(normalizeTitanSurface('customer'),'hub')});
test('company boundary rejects legacy tenancy',()=>assert.throws(()=>requireCompanyId({company_id:'c1',tenant_id:'x'}),/legacy-company-boundary/));
test('storage requires exactly one canonical owner',()=>{const p={company_id:'c',storage_id:'s',role:'canonical',provider:'device',locality:'device',data_classes:['jobs']};assert.equal(assertSingleCanonicalOwner([p],'jobs').storage_id,'s');assert.throws(()=>assertSingleCanonicalOwner([],'jobs'))});
test('offline never elevates authority',()=>assert.equal(offlineAuthorityFailure('c').authority_may_increase,false));
test('Titan intelligence cost requires entitlement',()=>assert.throws(()=>assertIntelligenceNoImplicitTitanCost({company_id:'c',request_id:'r',capability:'chat',locality:'titan_managed',data_egress:'authorised',cost_class:'metered_titan',authority_granted:false}),/not-entitled/));
test('maximum privacy excludes provider and Titan managed',()=>assert.deepEqual(allowedLocalities('maximum_privacy'),['device','edge','customer_hosted']));
test('placement filters company trust health capability and sovereignty',()=>{const req={company_id:'c1',capability:'chat',profile:'maximum_privacy',network:'online'};const cs=[{company_id:'c1',target_id:'cloud',locality:'titan_managed',capabilities:['chat'],trusted:true,healthy:true},{company_id:'c1',target_id:'edge',locality:'edge',capabilities:['chat'],trusted:true,healthy:true},{company_id:'c2',target_id:'other',locality:'device',capabilities:['chat'],trusted:true,healthy:true}];assert.deepEqual(rankPlacementCandidates(req,cs).map(x=>x.target_id),['edge'])});
test('offline placement remains local and cannot imply remote authority',()=>{const req={company_id:'c',capability:'vision',profile:'managed',network:'offline',allow_data_egress:true};const cs=[{company_id:'c',target_id:'remote',locality:'provider',capabilities:['vision'],trusted:true,healthy:true},{company_id:'c',target_id:'device',locality:'device',capabilities:['vision'],trusted:true,healthy:true}];assert.deepEqual(rankPlacementCandidates(req,cs).map(x=>x.target_id),['device'])});
test('routing receipts are authority neutral',()=>{const r=createRoutingReceipt({company_id:'c',receipt_id:'r',capability:'chat',locality:'device',data_egress:'none',created_at:'2026-09-20T00:00:00Z',decision:'selected',selected_target_id:'d',sovereignty_profile:'maximum_privacy',reason_codes:['local-first']});assert.equal(r.authority_effect,false);assert.equal(dataEgressForLocality('device'), 'none')});

test('execution lease is company/capability/target scoped and revocable',()=>{
  const lease=dist.issueExecutionLease({company_id:'c1',lease_id:'l1',target_id:'n1',capability:'vision',issued_at:'2026-01-01T00:00:00Z',expires_at:'2027-01-01T00:00:00Z'});
  assert.doesNotThrow(()=>dist.assertExecutionLeaseUsable(lease,{company_id:'c1',capability:'vision'},'n1',new Date('2026-06-01T00:00:00Z')));
  assert.throws(()=>dist.assertExecutionLeaseUsable({...lease,revoked_at:'2026-05-01T00:00:00Z'},{company_id:'c1',capability:'vision'},'n1',new Date('2026-06-01T00:00:00Z')),/revoked/);
});

test('failover never escapes sovereignty ranking',()=>{
 const req={company_id:'c1',capability:'infer',profile:'maximum_privacy',network:'online'};
 const cs=[{company_id:'c1',target_id:'device',locality:'device',capabilities:['infer'],trusted:true,healthy:true},{company_id:'c1',target_id:'provider',locality:'provider',capabilities:['infer'],trusted:true,healthy:true}];
 const d=dist.selectWithFailover(req,cs,new Set(['device']));
 assert.equal(d.selected,undefined); assert.equal(d.failure.code,'NO_EXECUTION_TARGET');
});

test('cross-fabric receipt explains sovereign fallback without authority',()=>{
 const req={company_id:'c1',request_id:'r1',fabric:'edge',capability:'infer',profile:'private_hybrid',network:'online'};
 const cs=[{company_id:'c1',target_id:'d1',locality:'device',capabilities:['infer'],trusted:true,healthy:true},{company_id:'c1',target_id:'e1',locality:'edge',capabilities:['infer'],trusted:true,healthy:true}];
 const d=dist.routeAcrossFabric(req,cs,new Set(['d1']),new Date('2026-01-01T00:00:00Z'));
 assert.equal(d.target.target_id,'e1'); assert.equal(d.receipt.decision,'fallback'); assert.equal(d.receipt.authority_effect,false); assert.equal(d.receipt.data_egress,'none');
});

test('revocation propagates across selected fabrics and revokes leases',()=>{
 const lease=dist.issueExecutionLease({company_id:'c',lease_id:'l',target_id:'n',capability:'chat',issued_at:'2026-01-01T00:00:00Z',expires_at:'2027-01-01T00:00:00Z'});
 const states=[{company_id:'c',fabric:'edge',target_id:'n',lease,trusted:true,revoked:false,healthy:true},{company_id:'c',fabric:'storage',target_id:'n',trusted:true,revoked:false,healthy:true},{company_id:'other',fabric:'edge',target_id:'n',trusted:true,revoked:false,healthy:true}];
 const next=dist.propagateRevocation({company_id:'c',revocation_id:'r',target_id:'n',reason:'trust_revoked',created_at:'2026-06-01T00:00:00Z',fabrics:['edge','storage','intelligence']},states);
 assert.equal(next[0].revoked,true); assert.equal(next[0].lease.revoked_at,'2026-06-01T00:00:00Z'); assert.equal(next[2].revoked,false);
});

test('offline command cannot mutate canonical state before authority recheck',()=>{
 const q=dist.queueOfflineCommand({company_id:'c',surface:'zero',command_id:'cmd',capability:'jobs.write',mutation_kind:'update',queued_at:'2026-01-01T00:00:00Z',authority_snapshot_ref:'a1'});
 assert.throws(()=>dist.assertCanonicalMutationReleased(q),/authority-recheck/);
 const denied=dist.revalidateQueuedCommand(q,'c',false); assert.equal(denied.state,'denied');
 const released=dist.revalidateQueuedCommand(q,'c',true); assert.equal(released.state,'released'); assert.doesNotThrow(()=>dist.assertCanonicalMutationReleased(released));
});

test('resource pressure contracts execution without increasing authority',()=>{
 assert.equal(dist.degradedExecutionMode({battery:'low',thermal:'normal',memory:'normal',storage:'normal'}),'degraded');
 const f=dist.degradedFailure('c',dist.degradedExecutionMode({battery:'normal',thermal:'critical',memory:'normal',storage:'normal'}));
 assert.equal(f.disposition,'deny'); assert.equal(f.authority_may_increase,false);
});

test('revoked or unhealthy fabric targets fail closed',()=>{
 assert.throws(()=>dist.assertFabricExecutionSafe({company_id:'c',fabric:'edge',target_id:'n',trusted:true,revoked:true,healthy:true}),/revoked/);
 assert.throws(()=>dist.assertFabricExecutionSafe({company_id:'c',fabric:'storage',target_id:'s',trusted:true,revoked:false,healthy:false}),/unhealthy/);
});

test('distributed canonical mutation must pass authority recheck and Command Bus',()=>{
 let e=dist.prepareDistributedMutation({company_id:'c',surface:'zero',execution_id:'x',command_id:'cmd',capability:'jobs.write',mutation_kind:'update',locality:'edge',authority_recheck_ref:'ar',governance_ref:'g'});
 assert.throws(()=>dist.markCanonicalMutation(e),/command-bus/);
 e=dist.markAuthorityRechecked(e,true);
 e=dist.acceptThroughCommandBus(e,{company_id:'c',surface:'zero',command_id:'cmd',accepted:true,receipt_ref:'cb1'});
 e=dist.markCanonicalMutation(e); assert.equal(e.state,'canonical_mutated');
});

test('accepted mutation emits Signal then Assurance evidence',()=>{
 let e=dist.prepareDistributedMutation({company_id:'c',surface:'zero',execution_id:'x2',command_id:'cmd2',capability:'jobs.write',mutation_kind:'create',locality:'device',authority_recheck_ref:'ar2',governance_ref:'g2'});
 e=dist.markAuthorityRechecked(e,true); e=dist.acceptThroughCommandBus(e,{company_id:'c',surface:'zero',command_id:'cmd2',accepted:true,receipt_ref:'cb2'}); e=dist.markCanonicalMutation(e);
 const s=dist.emitMutationSignal(e,'sig1','2026-09-20T00:00:00Z'); const a=dist.assureMutation(s.envelope,'cb2',s.signal,'ev1','2026-09-20T00:00:01Z');
 assert.equal(a.envelope.state,'assured'); assert.equal(a.evidence.verified,true); assert.equal(a.evidence.signal_ref,'sig1');
});

test('offline recovery re-enters through released command and Command Bus',()=>{
 const q=dist.queueOfflineCommand({company_id:'c',surface:'zero',command_id:'cmd3',capability:'jobs.write',mutation_kind:'update',queued_at:'2026-01-01T00:00:00Z',authority_snapshot_ref:'old'});
 const released=dist.revalidateQueuedCommand(q,'c',true);
 const e=dist.prepareDistributedMutation({company_id:'c',surface:'zero',execution_id:'x3',command_id:'cmd3',capability:'jobs.write',mutation_kind:'update',locality:'device',authority_recheck_ref:'new',governance_ref:'g3'});
 const accepted=dist.recoverOfflineCommandThroughCommandBus(released,e,{company_id:'c',surface:'zero',command_id:'cmd3',accepted:true,receipt_ref:'cb3'});
 assert.equal(accepted.state,'command_bus_accepted'); assert.equal(accepted.canonical_mutation_allowed,true);
});

test('durable receipt preserves provenance and remains authority neutral',()=>{
 const r=dist.createDurableDistributedReceipt({company_id:'c',receipt_id:'dr1',execution_id:'x4',command_id:'cmd4',capability:'infer',locality:'edge',data_egress:'none',created_at:'2026-09-20T00:00:00Z',decision:'fallback',selected_target_id:'edge2',sovereignty_profile:'maximum_privacy',fallback_from:'device1',reason_codes:['DEVICE_UNAVAILABLE'],authority_recheck_ref:'ar4',command_bus_receipt_ref:'cb4',signal_ref:'s4',assurance_ref:'a4',governance_ref:'g4',failover_chain:['device1','edge2']});
 assert.equal(r.authority_effect,false); assert.deepEqual(r.failover_chain,['device1','edge2']); assert.equal(r.data_egress,'none');
});

test('boundary adapter consumes legacy tenant aliases and emits company_id only', () => {
  const ctx = dist.normalizeDistributedContext({tenant_company_id:'c-1', surface:'owner'});
  assert.deepEqual(ctx, {company_id:'c-1', surface:'zero'});
  dist.assertCanonicalDistributedContext(ctx);
});

test('boundary adapter rejects conflicting company aliases', () => {
  assert.throws(() => dist.normalizeDistributedContext({company_id:'c-1', tenant_id:'c-2', surface:'go'}), /conflicting-company-boundary-inputs/);
});

test('canonical surfaces normalize aliases and onboarding is a zero journey', () => {
  assert.equal(dist.normalizeTitanSurface('command'), 'zero');
  assert.equal(dist.normalizeTitanSurface('field'), 'go');
  assert.equal(dist.normalizeTitanSurface('customer'), 'hub');
  assert.throws(() => dist.normalizeTitanSurface('onboarding'), /unsupported-titan-surface/);
  assert.deepEqual(dist.normalizeDistributedContext({company_id:'c-1', surface:'onboarding'}), {company_id:'c-1', surface:'zero', journey:'onboarding'});
});

test('downstream canonical context rejects legacy tenant and surface keys', () => {
  assert.throws(() => dist.assertCanonicalDistributedContext({company_id:'c-1', tenant_id:'c-1', surface:'zero'}), /legacy-company-boundary/);
  assert.throws(() => dist.assertCanonicalDistributedContext({company_id:'c-1', surface:'zero', app:'owner'}), /legacy-surface-boundary/);
});

test('company binding preserves isolation and cannot be rebound cross-company', () => {
  const ctx = dist.normalizeDistributedContext({company_id:'c-1', surface:'worker'});
  assert.deepEqual(dist.bindCompany(ctx, {capability:'quote'}), {capability:'quote', company_id:'c-1'});
  assert.throws(() => dist.bindCompany(ctx, {company_id:'c-2', capability:'quote'}), /cross-company-distributed-contract/);
});

test('mutation lifecycle preserves canonical company and surface context',()=>{
 const ctx={company_id:'c1',surface:'go'};
 let e=dist.prepareDistributedMutation({...ctx,execution_id:'ctx1',command_id:'ctxcmd1',capability:'jobs.write',mutation_kind:'update',locality:'edge',authority_recheck_ref:'ar',governance_ref:'g'});
 e=dist.markAuthorityRechecked(e,true,ctx);
 e=dist.acceptThroughCommandBus(e,{...ctx,command_id:'ctxcmd1',accepted:true,receipt_ref:'cb'});
 e=dist.markCanonicalMutation(e); const out=dist.emitMutationSignal(e,'sctx','2026-09-20T00:00:00Z');
 assert.equal(out.signal.company_id,'c1'); assert.equal(out.signal.surface,'go');
 const a=dist.assureMutation(out.envelope,'cb',out.signal,'ev','2026-09-20T00:00:01Z'); assert.equal(a.evidence.surface,'go');
});

test('authority result cannot be replayed across company or surface',()=>{
 const e=dist.prepareDistributedMutation({company_id:'c1',surface:'zero',execution_id:'r1',command_id:'cmd',capability:'x',mutation_kind:'update',locality:'device',authority_recheck_ref:'a',governance_ref:'g'});
 assert.throws(()=>dist.markAuthorityRechecked(e,true,{company_id:'c2',surface:'zero'}),/context-mismatch/);
 assert.throws(()=>dist.markAuthorityRechecked(e,true,{company_id:'c1',surface:'hub'}),/context-mismatch/);
});

test('Command Bus cannot rewrite company surface or journey',()=>{
 let e=dist.prepareDistributedMutation({company_id:'c1',surface:'zero',journey:'onboarding',execution_id:'r2',command_id:'cmd2',capability:'x',mutation_kind:'create',locality:'device',authority_recheck_ref:'a',governance_ref:'g'});
 e=dist.markAuthorityRechecked(e,true);
 assert.throws(()=>dist.acceptThroughCommandBus(e,{company_id:'c1',surface:'hub',journey:'onboarding',command_id:'cmd2',accepted:true,receipt_ref:'cb'}),/context-mismatch/);
 assert.throws(()=>dist.acceptThroughCommandBus(e,{company_id:'c1',surface:'zero',command_id:'cmd2',accepted:true,receipt_ref:'cb'}),/context-mismatch/);
});

test('offline queue preserves canonical context and rejects tampering',()=>{
 const q=dist.queueOfflineCommand({company_id:'c',surface:'hub',command_id:'oq',capability:'x',mutation_kind:'update',queued_at:'2026-01-01T00:00:00Z',authority_snapshot_ref:'old'});
 assert.throws(()=>dist.revalidateQueuedCommand(q,'c',true,{company_id:'c',surface:'zero'}),/context-mismatch/);
 const released=dist.revalidateQueuedCommand(q,'c',true,{company_id:'c',surface:'hub'}); assert.equal(released.surface,'hub');
});

test('legacy surface aliases are boundary-only and downstream mutation rejects them',()=>{
 const ctx=dist.normalizeDistributedContext({company_id:'c',surface:'worker'}); assert.equal(ctx.surface,'go');
 assert.throws(()=>dist.prepareDistributedMutation({company_id:'c',surface:'worker',execution_id:'x',command_id:'x',capability:'x',mutation_kind:'x',locality:'device',authority_recheck_ref:'a',governance_ref:'g'}),/canonical-titan-surface/);
});

test('node provider model and trust evidence never mint business authority',()=>{
 const ceilings={company_id:'c',governance_allowed:false,autonomy_band:'predictive',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'auth1'};
 const d=dist.evaluateDistributedAuthority('trusted_auto',ceilings,{company_id:'c',node_id:'n',provider:'p',model:'m',trust_score:100,trust_ref:'t'});
 assert.equal(d.allowed,false); assert.equal(d.identity_effect,false); assert.equal(d.trust_effect,false); assert.ok(d.reason_codes.includes('GOVERNANCE_DENIED'));
});

test('autonomy ceiling cannot be bypassed by trusted identity',()=>{
 const d=dist.evaluateDistributedAuthority('predictive',{company_id:'c',governance_allowed:true,autonomy_band:'prepare',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'a'}, {company_id:'c',node_id:'trusted',trust_score:100});
 assert.equal(d.allowed,false); assert.equal(d.effective_band,'prepare'); assert.ok(d.reason_codes.includes('AUTONOMY_CEILING'));
});

test('risk assurance and capability remain independent authority ceilings',()=>{
 for (const c of [
  {risk_allowed:false,assurance:'green',capability_allowed:true,code:'RISK_DENIED'},
  {risk_allowed:true,assurance:'red',capability_allowed:true,code:'ASSURANCE_RED'},
  {risk_allowed:true,assurance:'green',capability_allowed:false,code:'CAPABILITY_DENIED'}]) {
   const d=dist.evaluateDistributedAuthority('ask_execute',{company_id:'c',governance_allowed:true,autonomy_band:'predictive',risk_allowed:c.risk_allowed,assurance:c.assurance,capability_allowed:c.capability_allowed,authority_ref:'a'}, {company_id:'c',provider:'x',model:'y',trust_score:999});
   assert.equal(d.allowed,false); assert.ok(d.reason_codes.includes(c.code));
  }
});

test('identity evidence is company bound and cannot cross authority boundary',()=>{
 assert.throws(()=>dist.evaluateDistributedAuthority('observe',{company_id:'c1',governance_allowed:true,autonomy_band:'predictive',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'a'},{company_id:'c2',node_id:'n'}),/cross-company-authority-evidence/);
});

test('authority decision is required before distributed placement execution',()=>{
 const d=dist.evaluateDistributedAuthority('ask_execute',{company_id:'c',governance_allowed:true,autonomy_band:'ask_execute',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'a'},{company_id:'c',node_id:'n'});
 assert.doesNotThrow(()=>dist.assertPlacementWithinAuthority(d,{company_id:'c'}));
 assert.throws(()=>dist.assertPlacementWithinAuthority({...d,allowed:false},{company_id:'c'}),/authority-denied/);
 assert.throws(()=>dist.assertPlacementWithinAuthority(d,{company_id:'other'}),/cross-company/);
});

test('governed execution lease binds existing authority without identity elevation',()=>{
 const authority=dist.evaluateDistributedAuthority('ask_execute',{company_id:'c',governance_allowed:true,autonomy_band:'trusted_auto',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'auth-pass2'},{company_id:'c',node_id:'n',trust_score:100});
 const lease=dist.issueGovernedExecutionLease({company_id:'c',lease_id:'gl1',target_id:'n',capability:'infer',issued_at:'2026-01-01T00:00:00Z',expires_at:'2027-01-01T00:00:00Z'},authority,{company_id:'c',node_id:'n',provider:'local',model:'m',trust_score:100});
 assert.equal(lease.authority_granted,false); assert.equal(lease.authority_ref,'auth-pass2'); assert.equal(lease.effective_band,'ask_execute');
});

test('denied authority cannot issue governed execution lease even for trusted target',()=>{
 const denied=dist.evaluateDistributedAuthority('autonomous',{company_id:'c',governance_allowed:true,autonomy_band:'prepare',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'a-deny'},{company_id:'c',node_id:'trusted',trust_score:999});
 assert.throws(()=>dist.issueGovernedExecutionLease({company_id:'c',lease_id:'x',target_id:'trusted',capability:'infer',issued_at:'2026-01-01T00:00:00Z',expires_at:'2027-01-01T00:00:00Z'},denied,{company_id:'c',node_id:'trusted',trust_score:999}),/authority-denied/);
});

test('trust health provider or model loss revokes target lease but never expands authority',()=>{
 const authority=dist.evaluateDistributedAuthority('ask_execute',{company_id:'c',governance_allowed:true,autonomy_band:'ask_execute',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'a'},{company_id:'c'});
 const base=dist.issueGovernedExecutionLease({company_id:'c',lease_id:'l',target_id:'n',capability:'infer',issued_at:'2026-01-01T00:00:00Z',expires_at:'2027-01-01T00:00:00Z'},authority);
 for (const patch of [{trusted:false,healthy:true},{trusted:true,healthy:false},{trusted:true,healthy:true,provider_available:false},{trusted:true,healthy:true,model_available:false}]) {
  const out=dist.reconcileExecutionLease(base,{company_id:'c',target_id:'n',...patch},'2026-06-01T00:00:00Z'); assert.equal(out.revoked_at,'2026-06-01T00:00:00Z'); assert.equal(out.authority_granted,false);
 }
});

test('governed failover preserves authority reference and cannot escape sovereignty',()=>{
 const authority=dist.evaluateDistributedAuthority('ask_execute',{company_id:'c',governance_allowed:true,autonomy_band:'ask_execute',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'af'},{company_id:'c'});
 const req={company_id:'c',capability:'infer',profile:'maximum_privacy',network:'online'};
 const cs=[{company_id:'c',target_id:'d',locality:'device',capabilities:['infer'],trusted:true,healthy:true},{company_id:'c',target_id:'cloud',locality:'titan_managed',capabilities:['infer'],trusted:true,healthy:true}];
 const out=dist.selectGovernedWithFailover(req,cs,authority,new Set(['d'])); assert.equal(out.selected,undefined); assert.equal(out.authority_ref,'af'); assert.equal(out.authority_effect,false);
});

test('governed cross-fabric routing carries authority provenance but receipt remains neutral',()=>{
 const authority=dist.evaluateDistributedAuthority('ask_execute',{company_id:'c',governance_allowed:true,autonomy_band:'ask_execute',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'route-auth'},{company_id:'c'});
 const out=dist.routeGovernedAcrossFabric({company_id:'c',request_id:'rg',fabric:'intelligence',capability:'infer',profile:'private_hybrid',network:'online'},[{company_id:'c',target_id:'edge',locality:'edge',capabilities:['infer'],trusted:true,healthy:true}],authority);
 assert.equal(out.target.target_id,'edge'); assert.equal(out.receipt.authority_effect,false); assert.ok(out.receipt.reason_codes.includes('AUTHORITY_REF:route-auth'));
});

test('governed execution rejects cross-company identity and target state',()=>{
 const authority=dist.evaluateDistributedAuthority('ask_execute',{company_id:'c',governance_allowed:true,autonomy_band:'ask_execute',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'a'},{company_id:'c'});
 assert.throws(()=>dist.issueGovernedExecutionLease({company_id:'c',lease_id:'l',target_id:'n',capability:'x',issued_at:'2026-01-01T00:00:00Z',expires_at:'2027-01-01T00:00:00Z'},authority,{company_id:'other',node_id:'n'}),/cross-company-execution-identity/);
 const lease=dist.issueGovernedExecutionLease({company_id:'c',lease_id:'l',target_id:'n',capability:'x',issued_at:'2026-01-01T00:00:00Z',expires_at:'2027-01-01T00:00:00Z'},authority);
 assert.throws(()=>dist.reconcileExecutionLease(lease,{company_id:'other',target_id:'n',trusted:true,healthy:true},'2026-06-01T00:00:00Z'),/cross-company-execution-state/);
});

test('workforce trust cycles create eligibility not authority',()=>{
 const e=dist.evaluateTrustEligibility({company_id:'c',agent_id:'a',capability:'calls.outbound',successful_cycles:5,required_cycles:5,worker_accepted:true,user_approved:true,system_unblocked:true,evidence_refs:['ev1']});
 assert.equal(e.eligible,true); assert.equal(e.authority_granted,false);
});

test('trust tri-handshake and evidence are mandatory for eligibility',()=>{
 for (const patch of [{successful_cycles:2},{system_unblocked:false},{user_approved:false},{worker_accepted:false},{evidence_refs:[]}]) {
  const e=dist.evaluateTrustEligibility({company_id:'c',agent_id:'a',capability:'x',successful_cycles:5,required_cycles:5,worker_accepted:true,user_approved:true,system_unblocked:true,evidence_refs:['ev'],...patch}); assert.equal(e.eligible,false); assert.equal(e.authority_granted,false);
 }
});

test('eligible trust cannot bypass governance autonomy risk assurance or capability ceilings',()=>{
 const trust=dist.evaluateTrustEligibility({company_id:'c',agent_id:'a',capability:'x',successful_cycles:5,required_cycles:5,worker_accepted:true,user_approved:true,system_unblocked:true,evidence_refs:['ev']});
 const ceilings={company_id:'c',governance_allowed:false,autonomy_band:'predictive',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'auth'};
 dist.assertTrustEligibilityMatchesAuthority(trust,ceilings);
 const d=dist.evaluateDistributedAuthority('trusted_auto',ceilings,{company_id:'c',trust_ref:'ev',trust_score:100}); assert.equal(d.allowed,false); assert.ok(d.reason_codes.includes('GOVERNANCE_DENIED'));
});

test('trust eligibility is company bound',()=>{
 const trust=dist.evaluateTrustEligibility({company_id:'c1',agent_id:'a',capability:'x',successful_cycles:5,required_cycles:5,worker_accepted:true,user_approved:true,system_unblocked:true,evidence_refs:['ev']});
 assert.throws(()=>dist.assertTrustEligibilityMatchesAuthority(trust,{company_id:'c2',governance_allowed:true,autonomy_band:'predictive',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'x'}),/cross-company-trust-authority/);
});

test('offline queued authority snapshot is provenance only and fresh denial wins',()=>{
 const q=dist.queueOfflineCommand({company_id:'c',surface:'zero',command_id:'offauth',capability:'x',mutation_kind:'update',queued_at:'2026-01-01T00:00:00Z',authority_snapshot_ref:'old'});
 const bound={...q,requested_authority_band:'ask_execute'};
 const denied=dist.evaluateDistributedAuthority('ask_execute',{company_id:'c',governance_allowed:false,autonomy_band:'predictive',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'fresh-deny'},{company_id:'c'});
 const out=dist.revalidateOfflineWithAuthority(bound,denied); assert.equal(out.state,'denied'); assert.equal(out.authority_snapshot_ref,'old');
});

test('offline release records fresh authority reference and preserves context',()=>{
 const q={...dist.queueOfflineCommand({company_id:'c',surface:'hub',command_id:'offok',capability:'x',mutation_kind:'update',queued_at:'2026-01-01T00:00:00Z',authority_snapshot_ref:'old'}),requested_authority_band:'ask_execute'};
 const fresh=dist.evaluateDistributedAuthority('ask_execute',{company_id:'c',governance_allowed:true,autonomy_band:'ask_execute',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'fresh-ok'},{company_id:'c'});
 const out=dist.revalidateOfflineWithAuthority(q,fresh); assert.equal(out.state,'released'); assert.equal(out.authority_snapshot_ref,'fresh-ok'); assert.equal(out.surface,'hub');
 assert.throws(()=>dist.revalidateOfflineWithAuthority(q,fresh,{company_id:'c',surface:'zero'}),/context-mismatch/);
});

test('failover cannot substitute or elevate authority',()=>{
 const allowed=dist.evaluateDistributedAuthority('ask_execute',{company_id:'c',governance_allowed:true,autonomy_band:'ask_execute',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'same'},{company_id:'c'});
 const denied={...allowed,allowed:false};
 assert.doesNotThrow(()=>dist.assertFailoverAuthorityInvariant(allowed,allowed));
 assert.throws(()=>dist.assertFailoverAuthorityInvariant(allowed,{...allowed,authority_ref:'other'}),/substitute-authority/);
 assert.throws(()=>dist.assertFailoverAuthorityInvariant(denied,allowed),/elevate-authority/);
});

test('offline and failover authority remain company bound',()=>{
 const a=dist.evaluateDistributedAuthority('observe',{company_id:'c1',governance_allowed:true,autonomy_band:'observe',risk_allowed:true,assurance:'green',capability_allowed:true,authority_ref:'a'},{company_id:'c1'});
 assert.throws(()=>dist.assertFailoverAuthorityInvariant(a,{...a,company_id:'c2'}),/cross-company/);
 const q={...dist.queueOfflineCommand({company_id:'c1',surface:'go',command_id:'x',capability:'x',mutation_kind:'x',queued_at:'2026-01-01T00:00:00Z',authority_snapshot_ref:'old'}),requested_authority_band:'observe'};
 assert.throws(()=>dist.revalidateOfflineWithAuthority(q,{...a,company_id:'c2'}),/context-mismatch/);
});

test('mutation ledger makes accepted distributed mutation idempotent across retry',()=>{
 let e=dist.prepareDistributedMutation({company_id:'c',surface:'zero',execution_id:'ex-idem',command_id:'cmd-idem',capability:'jobs.write',mutation_kind:'update',locality:'edge',authority_recheck_ref:'ar',governance_ref:'g'});
 e=dist.markAuthorityRechecked(e,true); e=dist.acceptThroughCommandBus(e,{company_id:'c',surface:'zero',command_id:'cmd-idem',accepted:true,receipt_ref:'cb-idem'}); e=dist.markCanonicalMutation(e);
 const ledger=new dist.MutationCommitLedger(); const a={company_id:'c',surface:'zero',mutation_id:'mut-1',mutation_hash:'sha256:abc',command_receipt_ref:'cb-idem',signal_id:'sig-idem',committed_at:'2026-09-20T00:00:00Z'};
 assert.equal(ledger.commit(e,a).duplicate,false); assert.equal(ledger.commit(e,a).duplicate,true);
});

test('same command cannot be replayed as a new canonical mutation',()=>{
 let e=dist.prepareDistributedMutation({company_id:'c',surface:'go',execution_id:'ex-r',command_id:'cmd-r',capability:'jobs.write',mutation_kind:'update',locality:'device',authority_recheck_ref:'ar',governance_ref:'g'});
 e=dist.markAuthorityRechecked(e,true); e=dist.acceptThroughCommandBus(e,{company_id:'c',surface:'go',command_id:'cmd-r',accepted:true,receipt_ref:'cb'}); e=dist.markCanonicalMutation(e);
 const ledger=new dist.MutationCommitLedger(); ledger.commit(e,{company_id:'c',surface:'go',mutation_id:'m1',mutation_hash:'h1',command_receipt_ref:'cb',signal_id:'s1',committed_at:'2026-09-20T00:00:00Z'});
 assert.throws(()=>ledger.commit(e,{company_id:'c',surface:'go',mutation_id:'m2',mutation_hash:'h1',command_receipt_ref:'cb',signal_id:'s2',committed_at:'2026-09-20T00:00:01Z'}),/command-replay-new-mutation-denied/);
});

test('mutation replay with altered payload or signal correlation fails closed',()=>{
 let e=dist.prepareDistributedMutation({company_id:'c',surface:'hub',execution_id:'ex-c',command_id:'cmd-c',capability:'x',mutation_kind:'update',locality:'device',authority_recheck_ref:'ar',governance_ref:'g'});
 e=dist.markAuthorityRechecked(e,true); e=dist.acceptThroughCommandBus(e,{company_id:'c',surface:'hub',command_id:'cmd-c',accepted:true,receipt_ref:'cb'}); e=dist.markCanonicalMutation(e);
 const ledger=new dist.MutationCommitLedger(); const a={company_id:'c',surface:'hub',mutation_id:'m',mutation_hash:'h1',command_receipt_ref:'cb',signal_id:'s',committed_at:'2026-09-20T00:00:00Z'}; const r=ledger.commit(e,a).record;
 assert.throws(()=>ledger.commit(e,{...a,mutation_hash:'h2'}),/mutation-replay-conflict/);
 assert.equal(dist.signalFromCommittedMutation(e,r).signal.signal_id,'s');
 assert.throws(()=>dist.signalFromCommittedMutation({...e,execution_id:'changed'},r),/correlation-mismatch/);
});

test('mutation ledger uniqueness is company bound',()=>{
 const mk=(company)=>{let e=dist.prepareDistributedMutation({company_id:company,surface:'zero',execution_id:`e-${company}`,command_id:'same-command',capability:'x',mutation_kind:'update',locality:'device',authority_recheck_ref:'a',governance_ref:'g'});e=dist.markAuthorityRechecked(e,true);e=dist.acceptThroughCommandBus(e,{company_id:company,surface:'zero',command_id:'same-command',accepted:true,receipt_ref:'cb'});return dist.markCanonicalMutation(e)};
 const ledger=new dist.MutationCommitLedger();
 assert.equal(ledger.commit(mk('c1'),{company_id:'c1',surface:'zero',mutation_id:'m',mutation_hash:'h',command_receipt_ref:'cb',signal_id:'s1',committed_at:'2026-09-20T00:00:00Z'}).duplicate,false);
 assert.equal(ledger.commit(mk('c2'),{company_id:'c2',surface:'zero',mutation_id:'m',mutation_hash:'h',command_receipt_ref:'cb',signal_id:'s2',committed_at:'2026-09-20T00:00:00Z'}).duplicate,false);
});
