// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-agent/starter-workforce/reception/runtime/reception-knowledge-resolver.mjs
const PRICE_RE = /(?:\$|€|£|\b(?:aud|usd|eur|gbp)\b|\bprice\b|\bcost\b|\bfee\b)/i;
const COMMITMENT_RE = /\b(?:guarantee|guaranteed|promise|definitely|will arrive|same day|available at|booked|confirmed)\b/i;

function required(value, name) {
  const out = typeof value === 'string' ? value.trim() : '';
  if (!out) throw new TypeError(`${name} is required`);
  return out;
}
function clean(value, max = 4000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function arr(value) { return Array.isArray(value) ? value : []; }
function norm(value) { return clean(value, 500).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function tokens(value) { return new Set(norm(value).split(/\s+/).filter(x => x.length > 1)); }
function overlap(a, b) { const aa=tokens(a), bb=tokens(b); if(!aa.size||!bb.size)return 0; let n=0; for(const x of aa)if(bb.has(x))n++; return n/Math.max(aa.size,bb.size); }
function companyMatch(item, companyId) { return !item.company_id || clean(item.company_id,128) === companyId; }
function safeKnowledge(item, companyId) {
  if (!companyMatch(item, companyId)) return false;
  if (item.approved === false) return false;
  if (['STALE','UNKNOWN'].includes(clean(item.freshness,20).toUpperCase())) return false;
  if (['CONFIRMED','UNRESOLVED'].includes(clean(item.contradiction_state,30).toUpperCase())) return false;
  return true;
}
function candidate(kind, item, companyId) {
  if (!item || !safeKnowledge(item, companyId)) return null;
  const answer = clean(item.answer || item.description || item.summary || item.details);
  const name = clean(item.name || item.question || item.title);
  if (!answer && !name) return null;
  return {kind, id: clean(item.knowledge_id || item.service_id || item.faq_id || item.id || `${kind}:${norm(name)}`,220), name, answer, source_ref: clean(item.source_ref || item.provenance_ref || item.version || 'configured-business-knowledge',300), grants_authority:false};
}

export function buildReceptionKnowledgeIndex(input = {}) {
  const company_id = required(input.company_id, 'company_id');
  const entries = [];
  for (const f of arr(input.faqs)) { const c=candidate('faq',f,company_id); if(c) entries.push(c); }
  for (const s of arr(input.services)) { const c=candidate('service',s,company_id); if(c) entries.push(c); }
  for (const k of arr(input.knowledge)) { const c=candidate('business_knowledge',k,company_id); if(c) entries.push(c); }
  return Object.freeze({schema:'titan.zero.reception.knowledge-index/v1',company_id,entries:Object.freeze(entries),knowledge_is_not_authority:true,authority_granted:false});
}

export function answerReceptionKnowledgeQuestion(input = {}) {
  const company_id = required(input.company_id, 'company_id');
  const question = required(input.question, 'question');
  const index = input.index || buildReceptionKnowledgeIndex({...input, company_id});
  if (index.company_id !== company_id) throw new Error('reception-knowledge-cross-company-index');
  const ranked = arr(index.entries).map(e => ({...e, score: Math.max(overlap(question,e.name), overlap(question,`${e.name} ${e.answer}`))})).sort((a,b)=>b.score-a.score);
  const best = ranked[0];
  const minScore = Number.isFinite(input.min_score) ? Math.max(0, Number(input.min_score)) : 0.22;
  if (!best || best.score < minScore) return unknown(company_id, 'no_approved_match');
  const text = clean(best.answer || best.name);
  if (!text) return unknown(company_id, 'approved_match_has_no_answer');
  if ((PRICE_RE.test(question) || PRICE_RE.test(text)) && best.kind !== 'service') return escalate(company_id,'pricing_requires_authoritative_service_source');
  if (COMMITMENT_RE.test(text)) return escalate(company_id,'commitment_requires_governed_confirmation');
  return Object.freeze({schema:'titan.zero.reception.knowledge-answer/v1',company_id,status:'answered',answer:text,knowledge_id:best.id,knowledge_kind:best.kind,source_ref:best.source_ref,confidence:Math.round(best.score*1000)/1000,requires_handoff:false,requires_authoritative_action:false,knowledge_is_not_authority:true,authority_granted:false,grants_authority:false});
}

function unknown(company_id, reason) { return Object.freeze({schema:'titan.zero.reception.knowledge-answer/v1',company_id,status:'unknown',answer:"I don't have an approved answer for that yet. I can take a message or arrange a human follow-up.",reason,requires_handoff:true,handoff_reason:'knowledge_unknown',requires_authoritative_action:false,knowledge_is_not_authority:true,authority_granted:false,grants_authority:false}); }
function escalate(company_id, reason) { return Object.freeze({schema:'titan.zero.reception.knowledge-answer/v1',company_id,status:'escalate',answer:'That needs confirmation before I can give you a definite answer. I can arrange a human follow-up.',reason,requires_handoff:true,handoff_reason:reason,requires_authoritative_action:true,knowledge_is_not_authority:true,authority_granted:false,grants_authority:false}); }

export function buildReceptionKnowledgeHandoff(answer = {}) {
  const company_id = required(answer.company_id, 'company_id');
  if (!answer.requires_handoff) return null;
  return Object.freeze({schema:'titan.zero.reception.knowledge-handoff-request/v1',company_id,target_worker:'customer_care',reason:clean(answer.handoff_reason || answer.reason || 'knowledge_follow_up',120),requested_action:'human_follow_up',authority_granted:false,automatic_execution:false});
}
