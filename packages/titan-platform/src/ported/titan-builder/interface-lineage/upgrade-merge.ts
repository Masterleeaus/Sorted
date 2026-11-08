// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-builder/interface-lineage/upgrade-merge.mjs
function clone(v){ return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function equal(a,b){ return JSON.stringify(a) === JSON.stringify(b); }
function isObj(v){ return v && typeof v === 'object' && !Array.isArray(v); }

export function threeWayMerge({baseline, company, extension}) {
  const conflicts=[];
  const walk=(base,mine,theirs,path='')=>{
    if (equal(mine,theirs)) return clone(mine);
    if (equal(mine,base)) return clone(theirs);
    if (equal(theirs,base)) return clone(mine);
    if (isObj(base)||isObj(mine)||isObj(theirs)) {
      const out={};
      const keys=new Set([...Object.keys(base||{}),...Object.keys(mine||{}),...Object.keys(theirs||{})]);
      for (const k of keys) out[k]=walk(base?.[k],mine?.[k],theirs?.[k],path?`${path}.${k}`:k);
      return out;
    }
    conflicts.push(path || '$');
    return clone(mine); // company customization wins until explicit review
  };
  return {merged:walk(baseline,company,extension), conflicts, requires_review:conflicts.length>0};
}

export function rebaseCustomization({companyDraft,newExtensionDefault,newFingerprint,action='keep-mine'}) {
  if (!['keep-mine','adopt-default'].includes(action)) throw new Error('unsupported-rebase-action');
  return {
    draft: clone(action==='adopt-default' ? newExtensionDefault : companyDraft),
    baseline: clone(newExtensionDefault),
    baseline_fingerprint: newFingerprint || null,
    publish_requested: false
  };
}
