// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/intelligence-team-b.mjs
import { ZERO_KEYS, readLocal, updateLocal, timestamp } from './storage.js';
import { buildEvidenceIndependence } from './evidence-independence.js';

export const TEAM_B_LENSES = Object.freeze([
  'provenance-reality',
  'relational-consistency',
  'anomaly-signature',
  'authenticity-integrity'
]);

export const DEFAULT_TEAM_B = Object.freeze({ assessments: [], updatedAt: 0 });

function bounded(items, limit = 250) { return Array.isArray(items) ? items.slice(-limit) : []; }
function str(value, code) { const text = value == null ? '' : String(value).trim(); if (!text) throw new Error(code); return text; }
function confidence(value) { const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error('team-b-confidence-invalid'); return n; }
function normalisedSource(value) { return String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-'); }
function containsForbiddenKey(value) {
  if (!value || typeof value !== 'object') return false;
  for (const [key, nested] of Object.entries(value)) {
    const k = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['teama','teamaanlysis','teamanalysis','otherteamoutputs','comparison','convergence','divergence'].includes(k)) return true;
    if (containsForbiddenKey(nested)) return true;
  }
  return false;
}
function evidenceItem(item, index) {
  if (!item || typeof item !== 'object') throw new Error(`team-b-evidence-invalid:${index}`);
  const source = str(item.source || 'unspecified', `team-b-evidence-source-required:${index}`);
  const sourceNorm = normalisedSource(source);
  if (sourceNorm === 'team-a' || sourceNorm === 'intelligence-team-a' || sourceNorm.startsWith('team-a-')) throw new Error('team-b-independence-contaminated');
  if (containsForbiddenKey(item.provenance)) throw new Error('team-b-independence-contaminated');
  return Object.freeze({
    evidence_id: str(item.evidence_id || item.id || `e${index + 1}`, `team-b-evidence-id-required:${index}`),
    kind: str(item.kind || 'observation', `team-b-evidence-kind-required:${index}`),
    source,
    claim: str(item.claim ?? item.value, `team-b-evidence-claim-required:${index}`),
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
function rejectTeamALeak(input = {}) {
  if (containsForbiddenKey(input)) throw new Error('team-b-independence-contaminated');
}

export async function createTeamBAnalysis(input = {}) {
  rejectTeamALeak(input);
  const company_id = str(input.company_id, 'team-b-company-id-required');
  const item_id = str(input.item_id, 'team-b-item-id-required');
  const revision_id = str(input.revision_id, 'team-b-revision-id-required');
  const lens = str(input.lens || 'provenance-reality', 'team-b-lens-required');
  if (!TEAM_B_LENSES.includes(lens)) throw new Error('team-b-lens-invalid');
  const evidence = (input.evidence || []).map(evidenceItem);
  if (!evidence.length) throw new Error('team-b-evidence-required');
  const interpretation = str(input.interpretation, 'team-b-interpretation-required');
  const unresolved = bounded((input.unresolved || []).map(String), 50);
  const sealed_at = Number(input.sealed_at || timestamp());
  const payload = {
    schema_version: 1,
    team: 'B',
    independent: true,
    sealed: true,
    information_firewall: 'team-a-conclusions-unavailable',
    company_id,
    item_id,
    revision_id,
    analysis_id: str(input.analysis_id || crypto.randomUUID(), 'team-b-analysis-id-required'),
    lens,
    evidence,
    evidence_independence: buildEvidenceIndependence(input, evidence, 'B', revision_id),
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

export async function verifyTeamBSeal(analysis) {
  if (!analysis || analysis.team !== 'B' || analysis.sealed !== true || analysis.independent !== true) return false;
  if (analysis.information_firewall !== 'team-a-conclusions-unavailable') return false;
  const copy = structuredClone(analysis);
  const expected = copy.seal_digest;
  delete copy.seal_digest;
  return expected === await sha256(stable(copy));
}

export async function storeTeamBAnalysis(input = {}) {
  const analysis = input?.seal_digest ? deepFreeze(structuredClone(input)) : await createTeamBAnalysis(input);
  if (!(await verifyTeamBSeal(analysis))) throw new Error('team-b-seal-invalid');
  return updateLocal(ZERO_KEYS.teamB, DEFAULT_TEAM_B, current => {
    if ((current.assessments || []).some(item => item.analysis_id === analysis.analysis_id)) throw new Error('team-b-analysis-id-duplicate');
    return { ...current, assessments: bounded([...(current.assessments || []), structuredClone(analysis)], 250), updatedAt: timestamp() };
  });
}

export async function getTeamBState() { return readLocal(ZERO_KEYS.teamB, DEFAULT_TEAM_B); }
