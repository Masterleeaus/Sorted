// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/intelligence-team-a.mjs
import { ZERO_KEYS, readLocal, updateLocal, timestamp } from './storage.js';
import { buildEvidenceIndependence } from './evidence-independence.js';

export const TEAM_A_LENSES = Object.freeze([
  'meaning-context',
  'temporal-causal',
  'consequence-state-transition',
  'domain-specialist'
]);

export const DEFAULT_TEAM_A = Object.freeze({ assessments: [], updatedAt: 0 });

function bounded(items, limit = 250) { return Array.isArray(items) ? items.slice(-limit) : []; }
function str(value, code) { const text = value == null ? '' : String(value).trim(); if (!text) throw new Error(code); return text; }
function confidence(value) { const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error('team-a-confidence-invalid'); return n; }
function evidenceItem(item, index) {
  if (!item || typeof item !== 'object') throw new Error(`team-a-evidence-invalid:${index}`);
  return Object.freeze({
    evidence_id: str(item.evidence_id || item.id || `e${index + 1}`, `team-a-evidence-id-required:${index}`),
    kind: str(item.kind || 'observation', `team-a-evidence-kind-required:${index}`),
    source: str(item.source || 'unspecified', `team-a-evidence-source-required:${index}`),
    claim: str(item.claim ?? item.value, `team-a-evidence-claim-required:${index}`),
    confidence: item.confidence == null ? null : confidence(item.confidence),
    provenance: item.provenance == null ? null : structuredClone(item.provenance)
  });
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}
async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function rejectCrossTeamLeak(input = {}) {
  const forbidden = ['team_b','teamB','team_c','teamC','other_team_outputs','comparison','convergence','divergence'];
  if (forbidden.some(key => key in input)) throw new Error('team-a-independence-contaminated');
}

export async function createTeamAAnalysis(input = {}) {
  rejectCrossTeamLeak(input);
  const company_id = str(input.company_id, 'team-a-company-id-required');
  const item_id = str(input.item_id, 'team-a-item-id-required');
  const revision_id = str(input.revision_id, 'team-a-revision-id-required');
  const lens = str(input.lens || 'meaning-context', 'team-a-lens-required');
  if (!TEAM_A_LENSES.includes(lens)) throw new Error('team-a-lens-invalid');
  const evidence = (input.evidence || []).map(evidenceItem);
  if (!evidence.length) throw new Error('team-a-evidence-required');
  const interpretation = str(input.interpretation, 'team-a-interpretation-required');
  const unresolved = bounded((input.unresolved || []).map(String), 50);
  const sealed_at = Number(input.sealed_at || timestamp());
  const payload = {
    schema_version: 1,
    team: 'A',
    independent: true,
    sealed: true,
    company_id,
    item_id,
    revision_id,
    analysis_id: str(input.analysis_id || crypto.randomUUID(), 'team-a-analysis-id-required'),
    lens,
    evidence,
    evidence_independence: buildEvidenceIndependence(input, evidence, 'A', revision_id),
    interpretation,
    confidence: confidence(input.confidence),
    unresolved,
    assessor: input.assessor ? structuredClone(input.assessor) : { type: 'unspecified' },
    risk_level_at_analysis: input.risk_level == null ? null : String(input.risk_level),
    sealed_at
  };
  const seal_digest = await sha256(stable(payload));
  return deepFreeze({ ...payload, seal_digest });
}

export async function verifyTeamASeal(analysis) {
  if (!analysis || analysis.team !== 'A' || analysis.sealed !== true || analysis.independent !== true) return false;
  const copy = structuredClone(analysis);
  const expected = copy.seal_digest;
  delete copy.seal_digest;
  return expected === await sha256(stable(copy));
}

export async function storeTeamAAnalysis(input = {}) {
  const analysis = input?.seal_digest ? deepFreeze(structuredClone(input)) : await createTeamAAnalysis(input);
  if (!(await verifyTeamASeal(analysis))) throw new Error('team-a-seal-invalid');
  return updateLocal(ZERO_KEYS.teamA, DEFAULT_TEAM_A, current => {
    if ((current.assessments || []).some(item => item.analysis_id === analysis.analysis_id)) throw new Error('team-a-analysis-id-duplicate');
    return { ...current, assessments: bounded([...(current.assessments || []), structuredClone(analysis)], 250), updatedAt: timestamp() };
  });
}

export async function getTeamAState() { return readLocal(ZERO_KEYS.teamA, DEFAULT_TEAM_A); }
