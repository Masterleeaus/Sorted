// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/core/storage.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
export const ZERO_KEYS = Object.freeze({
  runtime: 'titan.zero.runtime.v2',
  context: 'titan.zero.context.v1',
  workingState: 'titan.zero.working-state.v1',
  memory: 'titan.zero.memory.v1',
  preferences: 'titan.zero.preferences.v1',
  knowledge: 'titan.zero.knowledge.v1',
  capabilities: 'titan.zero.capabilities.v1',
  confidence: 'titan.zero.confidence.v1',
  journeys: 'titan.zero.journeys.v1',
  intelligence: 'titan.zero.accumulated-intelligence.v1',
  processing: 'titan.zero.processing-lifecycle.v1',
  teamA: 'titan.zero.intelligence.team-a.v1',
  teamB: 'titan.zero.intelligence.team-b.v1',
  convergence: 'titan.zero.intelligence.convergence.v1',
  divergence: 'titan.zero.intelligence.divergence.v1',
  divergenceSeverity: 'titan.zero.intelligence.divergence-severity.v1',
  teamC: 'titan.zero.intelligence.team-c.v1',
  blindSpotChallenge: 'titan.zero.intelligence.shared-blind-spot.v1',
  highRiskAgreement: 'titan.zero.intelligence.high-risk-agreement.v1',
  zeroSynthesis: 'titan.zero.intelligence.zero-synthesis.v1'
});

export async function readLocal(key, fallback) {
  const result = await chrome.storage.local.get(key);
  return result?.[key] ?? structuredClone(fallback);
}

export async function writeLocal(key, value) {
  await chrome.storage.local.set({ [key]: value });
  return value;
}

export async function updateLocal(key, fallback, updater) {
  const current = await readLocal(key, fallback);
  const next = await updater(structuredClone(current));
  await writeLocal(key, next);
  return next;
}

export function timestamp() { return Date.now(); }
