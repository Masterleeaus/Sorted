// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/semantic-evidence.mjs
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);for(const x of Object.values(v))freeze(x)}return v};
function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return `[${v.map(stable).join(',')}]`;return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`}
async function sha(t){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}
const clamp=n=>Math.max(0,Math.min(1,Number.isFinite(Number(n))?Number(n):0));
export async function createSemanticEvidence(input={}){
 const company_id=String(input.company_id||'').trim(),item_id=String(input.item_id||'').trim(),revision_id=String(input.revision_id||'').trim();
 if(!company_id)throw new Error('semantic-evidence-company-id-required');if(!item_id)throw new Error('semantic-evidence-item-id-required');if(!revision_id)throw new Error('semantic-evidence-revision-id-required');
 const interpretation=String(input.interpretation||input.appears_to_mean||'').trim();if(!interpretation)throw new Error('semantic-evidence-interpretation-required');
 const alternatives=(input.alternatives||[]).map(x=>typeof x==='string'?{interpretation:x}:x).filter(x=>String(x?.interpretation||'').trim()).slice(0,20);
 const payload={schema_version:1,evidence_id:input.evidence_id||crypto.randomUUID(),evidence_category:'semantic',company_id,item_id,revision_id,observation:input.observation??null,appears_to_mean:interpretation,context:input.context??null,alternatives,confidence:clamp(input.confidence??0.5),supporting_refs:[...(input.supporting_refs||input.sources||[])].slice(0,50),contradicting_refs:[...(input.contradicting_refs||[])].slice(0,50),lens:'meaning-context',epistemic_status:'interpretive-evidence-not-fact',authority:{is_fact:false,is_truth_source:false,may_approve:false,may_authorise:false,may_apply:false},created_at:Number(input.created_at||Date.now())};
 const seal_digest=await sha(stable(payload));return freeze({...payload,sealed:true,seal_digest});
}
export async function verifySemanticEvidenceSeal(r){if(!r||r.sealed!==true||r.evidence_category!=='semantic')return false;const c=structuredClone(r),e=c.seal_digest;delete c.seal_digest;delete c.sealed;return e===await sha(stable(c));}
