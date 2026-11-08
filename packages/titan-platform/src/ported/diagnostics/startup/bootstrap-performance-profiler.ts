// @ts-nocheck
// Ported from Titan Zero extension (portable-core): diagnostics/startup/bootstrap-performance-profiler.mjs
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const percentile = (values, q) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1, Math.max(0, Math.ceil(sorted.length*q)-1))];
};

export function summarizeBootstrapPerformance(samples=[], limits={}) {
  if (!Array.isArray(samples)) throw new Error('bootstrap-performance-samples-must-be-array');
  const normalized = samples.map(sample => Object.freeze({
    duration_ms: Math.max(0, finite(sample?.duration_ms)),
    heap_delta_bytes: finite(sample?.heap_delta_bytes),
    candidate_tabs: Math.max(0, Math.trunc(finite(sample?.candidate_tabs))),
    peak_concurrency: Math.max(0, Math.trunc(finite(sample?.peak_concurrency))),
  }));
  const durations = normalized.map(x=>x.duration_ms);
  const positiveHeap = normalized.map(x=>Math.max(0,x.heap_delta_bytes));
  const p95Duration = percentile(durations,0.95);
  const p95Heap = percentile(positiveHeap,0.95);
  const durationLimit = Math.max(0,finite(limits?.p95_duration_ms||250));
  const heapLimit = Math.max(0,finite(limits?.p95_heap_delta_bytes||4*1024*1024));
  return Object.freeze({
    schema:'titan.chrome-load.bootstrap-performance.v1',
    samples:Object.freeze(normalized),
    sample_count:normalized.length,
    p50_duration_ms:percentile(durations,0.50),
    p95_duration_ms:p95Duration,
    p95_heap_delta_bytes:p95Heap,
    max_candidate_tabs:Math.max(0,...normalized.map(x=>x.candidate_tabs)),
    max_peak_concurrency:Math.max(0,...normalized.map(x=>x.peak_concurrency)),
    limits:Object.freeze({p95_duration_ms:durationLimit,p95_heap_delta_bytes:heapLimit}),
    ok:normalized.length>0&&p95Duration<=durationLimit&&p95Heap<=heapLimit,
    authority_effect:false,
    grants_authority:false,
    identity_not_authority:true,
  });
}
