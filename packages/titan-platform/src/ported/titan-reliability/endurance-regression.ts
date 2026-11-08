// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/endurance-regression.mjs
import { createBoundedWorkQueue } from './bounded-work-queue.js';
import { createFaultInjectionHarness } from './fault-injection-harness.js';
import { planGracefulDegradation } from './graceful-degradation.js';
import { createResourceLifecycleTracker } from './resource-lifecycle-tracker.js';
import { buildOperationalHealthSummary } from './operational-health-summary.js';

export async function runReliabilityEndurance({iterations=1000, company_id='endurance-company'}={}) {
  const count=Math.max(1,Number(iterations)||1000);
  const queue=createBoundedWorkQueue({name:'endurance-queue',concurrency:4,maxPending:64});
  const resources=createResourceLifecycleTracker({name:'endurance-resources',maxOpen:32});
  let tick=1_000_000;
  const faults=createFaultInjectionHarness({clock:()=>tick++});
  let degraded=0, blocked=0, offlineQueued=0;
  let jobs=[];
  for(let i=0;i<count;i+=1){
    const resourceKey=`cycle-${i}`;
    const opened=resources.register({key:resourceKey,type:'cycle',owner:'endurance'});
    if(!opened.ok) throw new Error(`resource-register-failed:${opened.reason}`);
    const unavailable=i%5===0;
    const operation={operation_class:'durable_write',company_id,operation_id:`op-${i}`,correlation_id:`corr-${i}`,idempotent:true,offline_queue_available:true};
    const dependency={kind:'network',dependency_id:'network-primary',company_id,available:!unavailable};
    const plan=planGracefulDegradation({dependency,operation,now:tick++});
    if(plan.degraded) degraded+=1;
    if(plan.fail_closed) blocked+=1;
    if(plan.durable_offline_queue_permitted) offlineQueued+=1;
    if(i%25===0){
      await faults.inject({company_id,operation_id:`op-${i}`,correlation_id:`corr-${i}`,idempotency_key:`idem-${i}`},{kind:'service_worker_restart',run:async()=>({resume_required:true})});
    }
    jobs.push(queue.run(async()=>i));
    if(jobs.length>=32){ await Promise.all(jobs); jobs=[]; }
    const released=resources.release(resourceKey);
    if(!released.ok) throw new Error('resource-release-failed');
  }
  await Promise.all(jobs);
  const resourceSnapshot=resources.assertBalanced();
  const queueSnapshot=queue.snapshot();
  const faultSnapshot=faults.snapshot();
  const summary=buildOperationalHealthSummary({
    company_id,
    degradation_plans:[],
    backpressure:queueSnapshot,
    lifecycle:{status:resourceSnapshot.balanced?'healthy':'unhealthy',failures:[]},
    generated_at:tick,
  });
  return Object.freeze({
    schema:'titan.reliability.endurance.v1',
    company_id,
    iterations:count,
    degraded_cycles:degraded,
    blocked_cycles:blocked,
    durable_offline_queued_cycles:offlineQueued,
    queue:queueSnapshot,
    resources:resourceSnapshot,
    faults:faultSnapshot,
    health:summary,
    bounded:queueSnapshot.depth===0 && resourceSnapshot.balanced,
    automatic_effect_replay:false,
    grants_authority:false,
    authority_effect:false,
  });
}
