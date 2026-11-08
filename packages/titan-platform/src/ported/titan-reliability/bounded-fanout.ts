// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/bounded-fanout.mjs
const clean = value => String(value ?? '').trim();
const arr = value => Array.isArray(value) ? value : [];

export function planBoundedFanout({company_id,max_total_children=32,max_parallel=4,targets=[]}={}) {
  const companyId=clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const total=Math.max(1,Math.floor(Number(max_total_children)||32));
  const parallel=Math.max(1,Math.min(total,Math.floor(Number(max_parallel)||4)));
  const unique=[];
  const seen=new Set();
  let duplicateCount=0;
  for (const target of arr(targets)) {
    const id=clean(target);
    if (!id) continue;
    if (seen.has(id)) { duplicateCount+=1; continue; }
    seen.add(id); unique.push(id);
  }
  const admitted=unique.slice(0,total);
  const rejected=unique.slice(total);
  const batches=[];
  for (let i=0;i<admitted.length;i+=parallel) batches.push(Object.freeze(admitted.slice(i,i+parallel)));
  return Object.freeze({
    schema:'titan.reliability.bounded-fanout.v1',
    company_id:companyId,
    max_total_children:total,
    max_parallel:parallel,
    admitted_ids:Object.freeze(admitted),
    rejected_ids:Object.freeze(rejected),
    batches:Object.freeze(batches),
    duplicate_count:duplicateCount,
    advisory_only:true,
    grants_authority:false,
    authority_effect:false,
  });
}
