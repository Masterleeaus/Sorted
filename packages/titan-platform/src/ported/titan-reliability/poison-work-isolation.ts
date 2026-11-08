// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/poison-work-isolation.mjs
const clean = value => String(value ?? '').trim();
const arr = value => Array.isArray(value) ? value : [];

export function isolatePoisonWork({company_id,max_failures=3,items=[]}={}) {
  const companyId=clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const threshold=Math.max(1,Math.floor(Number(max_failures)||3));
  const retryable=[];
  const quarantine=[];
  const blockedAuthority=[];
  for (const item of arr(items)) {
    const itemCompany=clean(item?.company_id);
    if (itemCompany && itemCompany!==companyId) throw new Error('cross-company:poison-work');
    const id=clean(item?.operation_id);
    if (!id) continue;
    const failures=Math.max(0,Math.floor(Number(item?.failure_count)||0));
    if (failures>=threshold) {
      quarantine.push(id);
      if (item?.authority_sensitive===true) blockedAuthority.push(id);
    } else {
      retryable.push(id);
    }
  }
  return Object.freeze({
    schema:'titan.reliability.poison-work-isolation.v1',
    company_id:companyId,
    max_failures:threshold,
    retryable_ids:Object.freeze(retryable),
    quarantine_ids:Object.freeze(quarantine),
    blocked_authority_ids:Object.freeze(blockedAuthority),
    automatic_replay:false,
    explicit_release_required:quarantine.length>0,
    advisory_only:true,
    grants_authority:false,
    authority_effect:false,
  });
}
