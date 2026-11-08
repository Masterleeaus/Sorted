// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/convergence-intelligence.mjs
import { ZERO_KEYS, readLocal, updateLocal, timestamp } from './storage.js';
import { compareEvidenceIndependence } from './evidence-independence.js';
import { verifyTeamASeal } from './intelligence-team-a.js';
import { verifyTeamBSeal } from './intelligence-team-b.js';

export const DEFAULT_CONVERGENCE = Object.freeze({ assessments: [], updatedAt: 0 });

function bounded(items, limit = 250) { return Array.isArray(items) ? items.slice(-limit) : []; }
function tokens(value) {
  return new Set(String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(x => x.length > 2));
}
function similarity(left, right) {
  const a = tokens(left), b = tokens(right);
  if (!a.size && !b.size) return 1;
  const intersection = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}
function round(n) { return Math.round(Math.max(0, Math.min(1, n)) * 10000) / 10000; }
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const k of Object.keys(value)) deepFreeze(value[k]); return value; }
function assertPair(a, b) {
  if (!a || !b) throw new Error('convergence-two-assessments-required');
  if (a.team !== 'A' || b.team !== 'B') throw new Error('convergence-team-pair-required');
  for (const field of ['company_id','item_id','revision_id']) if (String(a[field]) !== String(b[field])) throw new Error(`convergence-${field.replaceAll('_','-')}-mismatch`);
}
function independenceScore(a, b) {
  const compared = compareEvidenceIndependence(a.evidence_independence, b.evidence_independence);
  const ad = new Set(a.evidence_independence?.independence_domains || []);
  const bd = new Set(b.evidence_independence?.independence_domains || []);
  const denominator = Math.max(1, Math.min(ad.size || 0, bd.size || 0));
  const overlapRatio = compared.shared_domains.length / denominator;
  const score = ad.size && bd.size ? round(1 - Math.min(1, overlapRatio)) : 0;
  return { ...compared, score, left_domain_count: ad.size, right_domain_count: bd.size, overlap_ratio: round(overlapRatio) };
}

export async function assessConvergence(input = {}) {
  const a = input.team_a || input.teamA;
  const b = input.team_b || input.teamB;
  assertPair(a, b);
  if (!(await verifyTeamASeal(a))) throw new Error('convergence-team-a-seal-invalid');
  if (!(await verifyTeamBSeal(b))) throw new Error('convergence-team-b-seal-invalid');
  const semantic_similarity = round(similarity(a.interpretation, b.interpretation));
  const independence = independenceScore(a, b);
  const agreement_detected = semantic_similarity >= Number(input.agreement_threshold ?? 0.62);
  const independently_reached = agreement_detected && independence.score >= Number(input.independence_threshold ?? 0.7);
  const support_floor = Math.min(Number(a.confidence), Number(b.confidence));
  const confidence_evidence_strength = independently_reached ? round(support_floor * semantic_similarity * independence.score) : 0;
  const classification = !agreement_detected ? 'no-convergence' : independently_reached ? 'independent-convergence' : 'correlated-convergence';
  return deepFreeze({
    schema_version: 1,
    convergence_id: input.convergence_id || crypto.randomUUID(),
    company_id: a.company_id,
    item_id: a.item_id,
    revision_id: a.revision_id,
    compared_analysis_ids: [a.analysis_id, b.analysis_id],
    classification,
    agreement_detected,
    independently_reached,
    semantic_similarity,
    independence,
    confidence_evidence: {
      kind: 'independent-agreement',
      strength: confidence_evidence_strength,
      team_a_confidence: Number(a.confidence),
      team_b_confidence: Number(b.confidence),
      aggregation: 'not-averaged',
      note: independently_reached ? 'Agreement contributes additional confidence evidence in proportion to measured independence.' : 'Agreement is not treated as independent corroboration because measured independence is insufficient or agreement was not detected.'
    },
    assessed_at: Number(input.assessed_at || timestamp())
  });
}

export async function storeConvergence(input = {}) {
  const result = input?.classification ? structuredClone(input) : await assessConvergence(input);
  return updateLocal(ZERO_KEYS.convergence, DEFAULT_CONVERGENCE, current => {
    if ((current.assessments || []).some(x => x.convergence_id === result.convergence_id)) throw new Error('convergence-id-duplicate');
    return { ...current, assessments: bounded([...(current.assessments || []), result], 250), updatedAt: timestamp() };
  });
}

export async function getConvergenceState() { return readLocal(ZERO_KEYS.convergence, DEFAULT_CONVERGENCE); }
