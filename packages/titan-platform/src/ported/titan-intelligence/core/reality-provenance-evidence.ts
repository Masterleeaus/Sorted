// @ts-nocheck
// Compatibility dependency preserved from historical-reference: titan-intelligence/core/reality-provenance-evidence.mjs
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);for(const x of Object.values(v))freeze(x)}return v};
function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(stable).join(',')}]`;return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`}
async function sha(t){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}
const clamp=n=>Math.max(0,Math.min(1,Number.isFinite(Number(n))?Number(n):0));
export async function createRealityProvenanceEvidence(input={}){
 const company_id=String(input.company_id||'').trim(),item_id=String(input.item_id||'').trim(),revision_id=String(input.revision_id||'').trim();
 if(!company_id)throw new Error('provenance-evidence-company-id-required');if(!item_id)throw new Error('provenance-evidence-item-id-required');if(!revision_id)throw new Error('provenance-evidence-revision-id-required');
 const source=input.source||{};const transformations=[...(input.transformations||[])].slice(0,50);const custody=[...(input.chain_of_custody||[])].slice(0,50);const anomalies=[...(input.anomalies||[])].slice(0,50);
 const payload={schema_version:1,evidence_id:input.evidence_id||crypto.randomUUID(),evidence_category:'reality-provenance',company_id,item_id,revision_id,claim_under_test:input.claim_under_test??null,source:{source_id:source.source_id||input.source_id||null,origin:source.origin||input.origin||null,source_type:source.source_type||input.source_type||null,identity_verified:source.identity_verified===true,authenticity_signals:[...(source.authenticity_signals||input.authenticity_signals||[])].slice(0,50)},chain_of_custody:custody,transformations,timestamp_integrity:input.timestamp_integrity??null,relational_consistency:input.relational_consistency??null,anomalies,provenance_confidence:clamp(input.provenance_confidence??input.confidence??0.5),authenticity_state:anomalies.length?'uncertain':'not-disproved',epistemic_status:'reality-provenance-evidence-not-truth-guarantee',lens:'provenance-reality',authority:{is_truth_source:false,may_approve:false,may_authorise:false,may_apply:false},created_at:Number(input.created_at||Date.now())};
 const seal_digest=await sha(stable(payload));return freeze({...payload,sealed:true,seal_digest});
}
export async function verifyRealityProvenanceSeal(r){if(!r||r.sealed!==true||r.evidence_category!=='reality-provenance')return false;const c=structuredClone(r),e=c.seal_digest;delete c.seal_digest;delete c.sealed;return e===await sha(stable(c));}
