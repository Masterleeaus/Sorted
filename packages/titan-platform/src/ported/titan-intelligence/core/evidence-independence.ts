// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/evidence-independence.mjs
export const CONTRIBUTOR_TYPES = Object.freeze(['source','memory','rule','model','observation']);

function str(value, code) { const text = value == null ? '' : String(value).trim(); if (!text) throw new Error(code); return text; }
function norm(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const key of Object.keys(value)) deepFreeze(value[key]); return value; }
function containsTeam(value, team) {
  if (!value) return false;
  if (typeof value === 'string') return norm(value).includes(`team-${team.toLowerCase()}`);
  if (Array.isArray(value)) return value.some(v => containsTeam(v, team));
  if (typeof value === 'object') return Object.entries(value).some(([k,v]) => containsTeam(k, team) || containsTeam(v, team));
  return false;
}
function contributor(item, index, team) {
  if (!item || typeof item !== 'object') throw new Error(`evidence-independence-contributor-invalid:${index}`);
  const type = str(item.type, `evidence-independence-type-required:${index}`).toLowerCase();
  if (!CONTRIBUTOR_TYPES.includes(type)) throw new Error(`evidence-independence-type-invalid:${type}`);
  const id = str(item.contributor_id || item.id || `${type}:${index+1}`, `evidence-independence-id-required:${index}`);
  const origin = str(item.origin || item.source || id, `evidence-independence-origin-required:${index}`);
  if (team === 'B' && (containsTeam(id,'A') || containsTeam(origin,'A') || containsTeam(item.provenance,'A'))) throw new Error('team-b-independence-contaminated');
  return {
    contributor_id: id,
    type,
    origin,
    independence_domain: str(item.independence_domain || `${type}:${norm(origin) || 'unknown'}`, `evidence-independence-domain-required:${index}`),
    revision_id: item.revision_id == null ? null : String(item.revision_id),
    confidence: item.confidence == null ? null : Number(item.confidence),
    provenance: item.provenance == null ? null : structuredClone(item.provenance)
  };
}
export function buildEvidenceIndependence(input = {}, evidence = [], team = 'A', revision_id = null) {
  const explicit = Array.isArray(input.contributors) ? input.contributors : [];
  const derived = (evidence || []).map((e,i) => ({
    contributor_id: `evidence:${e.evidence_id || e.id || i+1}`,
    type: String(e.kind || '').toLowerCase().includes('memory') ? 'memory' : String(e.kind || '').toLowerCase().includes('rule') ? 'rule' : String(e.kind || '').toLowerCase().includes('model') ? 'model' : String(e.kind || '').toLowerCase().includes('observation') ? 'observation' : 'source',
    origin: e.source || e.evidence_id || `e${i+1}`,
    independence_domain: e.provenance?.independence_domain || e.provenance?.source_id || e.source || e.evidence_id || `e${i+1}`,
    revision_id,
    confidence: e.confidence,
    provenance: e.provenance
  }));
  const all = [...explicit, ...derived].map((x,i) => contributor(x,i,team));
  const seen = new Map();
  for (const c of all) if (!seen.has(`${c.type}|${c.contributor_id}`)) seen.set(`${c.type}|${c.contributor_id}`, c);
  const contributors = [...seen.values()];
  const by_type = Object.fromEntries(CONTRIBUTOR_TYPES.map(t => [t, contributors.filter(c => c.type === t).map(c => c.contributor_id)]));
  const domains = {};
  for (const c of contributors) (domains[c.independence_domain] ||= []).push(c.contributor_id);
  const correlated_domains = Object.entries(domains).filter(([,ids]) => ids.length > 1).map(([independence_domain, contributor_ids]) => ({ independence_domain, contributor_ids }));
  return deepFreeze({
    schema_version: 1,
    team,
    revision_id,
    contributor_count: contributors.length,
    contributors,
    by_type,
    independence_domains: Object.keys(domains),
    correlated_domains,
    has_potential_correlation: correlated_domains.length > 0
  });
}

export function compareEvidenceIndependence(left, right) {
  const l = new Set(left?.independence_domains || []), r = new Set(right?.independence_domains || []);
  const shared_domains = [...l].filter(x => r.has(x)).sort();
  return Object.freeze({ shared_domains, independent_domain_count: new Set([...l,...r]).size, has_shared_dependencies: shared_domains.length > 0 });
}
