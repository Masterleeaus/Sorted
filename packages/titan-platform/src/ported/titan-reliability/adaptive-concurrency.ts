// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/adaptive-concurrency.mjs
const clean = value => String(value ?? '').trim();
const arr = value => Array.isArray(value) ? value : [];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

export function planAdaptiveConcurrency({company_id,current_limit=1,min_limit=1,max_limit=32,target_latency_ms=500,samples=[]}={}) {
  const companyId=clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const min=Math.max(1,Math.floor(Number(min_limit)||1));
  const max=Math.max(min,Math.floor(Number(max_limit)||min));
  const current=clamp(Math.floor(Number(current_limit)||min),min,max);
  const target=Math.max(1,Number(target_latency_ms)||500);
  const rows=arr(samples);
  if (!rows.length) return Object.freeze({schema:'titan.reliability.adaptive-concurrency.v1',company_id:companyId,current_limit:current,next_limit:current,action:'hold',reason:'insufficient_samples',authority_effect:false,grants_authority:false,advisory_only:true});
  const latencies=rows.map(s=>Math.max(0,Number(s?.latency_ms)||0));
  const average=latencies.reduce((a,b)=>a+b,0)/latencies.length;
  const failures=rows.filter(s=>s?.ok===false).length;
  const failureRate=failures/rows.length;
  let next=current, action='hold', reason='stable';
  if (failureRate>=0.25 || average>target*1.25) {
    next=clamp(Math.floor(current/2),min,max); action=next<current?'reduce':'hold'; reason='pressure';
  } else if (failureRate===0 && average<target*0.6) {
    next=clamp(current+1,min,max); action=next>current?'increase':'hold'; reason='healthy_headroom';
  }
  return Object.freeze({
    schema:'titan.reliability.adaptive-concurrency.v1',company_id:companyId,
    current_limit:current,next_limit:next,action,reason,
    sample_count:rows.length,average_latency_ms:Math.round(average),failure_rate:failureRate,
    advisory_only:true,grants_authority:false,authority_effect:false,
  });
}
