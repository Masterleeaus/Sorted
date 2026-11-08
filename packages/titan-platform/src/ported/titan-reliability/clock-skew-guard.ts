// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/clock-skew-guard.mjs
const clean = value => String(value ?? '').trim();
const arr = value => Array.isArray(value) ? value : [];

export function assessClockSkew({company_id,allowed_skew_ms=5000,samples=[]}={}) {
  const companyId=clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const allowed=Math.max(0,Number(allowed_skew_ms)||0);
  const skewed=[];
  let maxAbs=0;
  for (const sample of arr(samples)) {
    const source=Number(sample?.source_at);
    const reference=Number(sample?.reference_at);
    if (!Number.isFinite(source) || !Number.isFinite(reference)) continue;
    const abs=Math.abs(source-reference);
    if (abs>maxAbs) maxAbs=abs;
    if (abs>allowed) skewed.push(clean(sample?.clock_id)||'unknown');
  }
  return Object.freeze({
    schema:'titan.reliability.clock-skew-guard.v1',
    company_id:companyId,
    allowed_skew_ms:allowed,
    max_abs_skew_ms:maxAbs,
    skewed_clock_ids:Object.freeze(skewed),
    safe_for_time_authority:skewed.length===0,
    rewrites_timestamps:false,
    advisory_only:true,
    grants_authority:false,
    authority_effect:false,
  });
}
