// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/overseer.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { initialisePersistentCore, heartbeat, getSnapshot, setContext, patchWorkingState, remember, setPreferences, addKnowledge, setCapabilities, setConfidence, upsertJourney, accumulate } from './core/persistent-core.js';
import { receiveForProcessing, transitionProcessing, getProcessingItem, getProcessingState } from './core/processing-lifecycle.js';
import { classifyRisk } from './core/risk-classification.js';
import { createTeamAAnalysis, storeTeamAAnalysis, getTeamAState, verifyTeamASeal } from './core/intelligence-team-a.js';
import { createTeamBAnalysis, storeTeamBAnalysis, getTeamBState, verifyTeamBSeal } from './core/intelligence-team-b.js';
import { assignIntelligenceLenses, validateLensAssignment } from './core/lens-assignment.js';
import { assessConvergence, storeConvergence, getConvergenceState } from './core/convergence-intelligence.js';
import { assessDivergence, storeDivergence, getDivergenceState } from './core/divergence-intelligence.js';
import { assessDivergenceSeverity, storeDivergenceSeverity, getDivergenceSeverityState } from './core/divergence-severity.js';
import { createTeamCAssurance, verifyTeamCSeal, storeTeamCAssurance, getTeamCState } from './core/intelligence-team-c.js';
import { assessSharedBlindSpots, verifySharedBlindSpotSeal, storeSharedBlindSpot, getSharedBlindSpotState } from './core/shared-blind-spot.js';
import { challengeHighRiskAgreement, verifyHighRiskAgreementSeal, storeHighRiskAgreementChallenge, getHighRiskAgreementState } from './core/high-risk-agreement-challenge.js';
import { synthesizeIntelligenceState, verifyZeroSynthesisSeal, storeZeroSynthesis, getZeroSynthesisState } from './core/zero-synthesis.js';
import { planIntelligenceTopology } from './core/dynamic-intelligence-topology.js';
import { createSemanticEvidence, verifySemanticEvidenceSeal } from './core/semantic-evidence.js';
import { createRealityProvenanceEvidence, verifyRealityProvenanceSeal } from './core/reality-provenance-evidence.js';
import { assessConsequences, verifyConsequenceSeal, assertConsequenceGateForAcceptance } from './core/consequence-intelligence.js';

const HEARTBEAT_ALARM = 'titan.zero.heartbeat';
const LEGACY_RUNTIME_KEY = 'titan.zero.runtime.v1';

export const TitanBoundary = Object.freeze({
  package: 'Titan Zero', userFacingSurface: 'Titan Zero', onDeviceOverseer: 'Titan Zero',
  legacyCompatibility: Object.freeze({ codeeMessageNames: true, codeeStorageKeys: true, nanobrowserRuntime: true })
});

async function ensureHeartbeatAlarm() {
  try { await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 }); } catch {}
}

async function discoverBaselineCapabilities() {
  const deterministic = ['state.persistence','context.local','memory.local','preferences.local','knowledge.local','confidence.local','journeys.local','intelligence.lens-assignment','intelligence.convergence','intelligence.divergence','intelligence.divergence-severity','intelligence.high-risk-agreement-challenge','intelligence.zero-synthesis','intelligence.dynamic-topology','evidence.semantic','evidence.reality-provenance','intelligence.consequence'];
  if (chrome.storage?.local) deterministic.push('browser.storage.local');
  if (chrome.tabs) deterministic.push('browser.tabs');
  if (chrome.scripting) deterministic.push('browser.scripting');
  if (chrome.sidePanel) deterministic.push('browser.side-panel');
  if (chrome.alarms) deterministic.push('browser.alarms');
  return setCapabilities({ deterministic, local: [], connected: [], discoveredAt: Date.now() });
}

async function boot() {
  const runtime = await initialisePersistentCore();
  await discoverBaselineCapabilities();
  await chrome.storage.local.set({ [LEGACY_RUNTIME_KEY]: { ...runtime, architectureVersion: 2 } });
  await ensureHeartbeatAlarm();
  return runtime;
}

chrome.runtime.onInstalled.addListener(() => { boot().catch(() => {}); });
chrome.runtime.onStartup?.addListener(() => { boot().catch(() => {}); });
chrome.alarms?.onAlarm.addListener(alarm => { if (alarm?.name === HEARTBEAT_ALARM) heartbeat().catch(() => {}); });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    TITAN_ZERO_STATUS: getSnapshot,
    TITAN_ZERO_SNAPSHOT: getSnapshot,
    TITAN_ZERO_SET_CONTEXT: () => setContext(message.patch),
    TITAN_ZERO_SET_WORKING_STATE: () => patchWorkingState(message.patch),
    TITAN_ZERO_REMEMBER: () => remember(message.kind, message.entry),
    TITAN_ZERO_SET_PREFERENCES: () => setPreferences(message.patch),
    TITAN_ZERO_ADD_KNOWLEDGE: () => addKnowledge(message.kind, message.entry),
    TITAN_ZERO_SET_CAPABILITIES: () => setCapabilities(message.capabilities),
    TITAN_ZERO_SET_CONFIDENCE: () => setConfidence(message.confidence),
    TITAN_ZERO_UPSERT_JOURNEY: () => upsertJourney(message.journey),
    TITAN_ZERO_ACCUMULATE: () => accumulate(message.kind, message.entry),
    TITAN_ZERO_PROCESS_RECEIVE: () => receiveForProcessing(message.item),
    TITAN_ZERO_PROCESS_TRANSITION: () => transitionProcessing(message.transition),
    TITAN_ZERO_PROCESS_ITEM: () => getProcessingItem(message.item_id),
    TITAN_ZERO_PROCESS_STATE: getProcessingState,
    TITAN_ZERO_CLASSIFY_RISK: () => classifyRisk(message.assessment || message.item || {}),
    TITAN_ZERO_ASSIGN_LENSES: () => assignIntelligenceLenses(message.assignment || message.item || {}),
    TITAN_ZERO_VALIDATE_LENS_ASSIGNMENT: () => validateLensAssignment(message.assignment || {}),
    TITAN_ZERO_TEAM_A_ANALYSE: () => createTeamAAnalysis(message.analysis || {}),
    TITAN_ZERO_TEAM_A_STORE: () => storeTeamAAnalysis(message.analysis || {}),
    TITAN_ZERO_TEAM_A_STATE: getTeamAState,
    TITAN_ZERO_TEAM_A_VERIFY: () => verifyTeamASeal(message.analysis || {}),
    TITAN_ZERO_TEAM_B_ANALYSE: () => createTeamBAnalysis(message.analysis || {}),
    TITAN_ZERO_TEAM_B_STORE: () => storeTeamBAnalysis(message.analysis || {}),
    TITAN_ZERO_TEAM_B_STATE: getTeamBState,
    TITAN_ZERO_TEAM_B_VERIFY: () => verifyTeamBSeal(message.analysis || {}),
    TITAN_ZERO_ASSESS_CONVERGENCE: () => assessConvergence(message.comparison || message.assessment || {}),
    TITAN_ZERO_STORE_CONVERGENCE: () => storeConvergence(message.comparison || message.assessment || {}),
    TITAN_ZERO_CONVERGENCE_STATE: getConvergenceState,
    TITAN_ZERO_ASSESS_DIVERGENCE: () => assessDivergence(message.comparison || message.assessment || {}),
    TITAN_ZERO_STORE_DIVERGENCE: () => storeDivergence(message.comparison || message.assessment || {}),
    TITAN_ZERO_DIVERGENCE_STATE: getDivergenceState,
    TITAN_ZERO_ASSESS_DIVERGENCE_SEVERITY: () => assessDivergenceSeverity(message.comparison || message.assessment || {}),
    TITAN_ZERO_STORE_DIVERGENCE_SEVERITY: () => storeDivergenceSeverity(message.comparison || message.assessment || {}),
    TITAN_ZERO_DIVERGENCE_SEVERITY_STATE: getDivergenceSeverityState,
    TITAN_ZERO_TEAM_C_ASSURE: () => createTeamCAssurance(message.assurance || message.assessment || {}),
    TITAN_ZERO_TEAM_C_VERIFY: () => verifyTeamCSeal(message.assurance || {}),
    TITAN_ZERO_TEAM_C_STORE: () => storeTeamCAssurance(message.assurance || message.assessment || {}),
    TITAN_ZERO_TEAM_C_STATE: getTeamCState,
    TITAN_ZERO_CHALLENGE_SHARED_BLIND_SPOTS: () => assessSharedBlindSpots(message.challenge || message.assessment || {}),
    TITAN_ZERO_VERIFY_SHARED_BLIND_SPOTS: () => verifySharedBlindSpotSeal(message.challenge || {}),
    TITAN_ZERO_STORE_SHARED_BLIND_SPOTS: () => storeSharedBlindSpot(message.challenge || message.assessment || {}),
    TITAN_ZERO_SHARED_BLIND_SPOT_STATE: getSharedBlindSpotState,
    TITAN_ZERO_CHALLENGE_HIGH_RISK_AGREEMENT: () => challengeHighRiskAgreement(message.challenge || message.assessment || {}),
    TITAN_ZERO_VERIFY_HIGH_RISK_AGREEMENT: () => verifyHighRiskAgreementSeal(message.challenge || {}),
    TITAN_ZERO_STORE_HIGH_RISK_AGREEMENT: () => storeHighRiskAgreementChallenge(message.challenge || message.assessment || {}),
    TITAN_ZERO_HIGH_RISK_AGREEMENT_STATE: getHighRiskAgreementState,
    TITAN_ZERO_SYNTHESIZE: () => synthesizeIntelligenceState(message.synthesis || message.assessment || {}),
    TITAN_ZERO_VERIFY_SYNTHESIS: () => verifyZeroSynthesisSeal(message.synthesis || {}),
    TITAN_ZERO_STORE_SYNTHESIS: () => storeZeroSynthesis(message.synthesis || message.assessment || {}),
    TITAN_ZERO_SYNTHESIS_STATE: getZeroSynthesisState,
    TITAN_ZERO_PLAN_INTELLIGENCE_TOPOLOGY: () => planIntelligenceTopology(message.topology || message.assessment || {}),
    TITAN_ZERO_CREATE_SEMANTIC_EVIDENCE: () => createSemanticEvidence(message.evidence || message.assessment || {}),
    TITAN_ZERO_VERIFY_SEMANTIC_EVIDENCE: () => verifySemanticEvidenceSeal(message.evidence || {}),
    TITAN_ZERO_CREATE_REALITY_PROVENANCE_EVIDENCE: () => createRealityProvenanceEvidence(message.evidence || message.assessment || {}),
    TITAN_ZERO_VERIFY_REALITY_PROVENANCE_EVIDENCE: () => verifyRealityProvenanceSeal(message.evidence || {}),
    TITAN_ZERO_ASSESS_CONSEQUENCES: () => assessConsequences(message.assessment || message.consequences || {}),
    TITAN_ZERO_VERIFY_CONSEQUENCES: () => verifyConsequenceSeal(message.assessment || {}),
    TITAN_ZERO_ASSERT_CONSEQUENCE_GATE: () => assertConsequenceGateForAcceptance(message.assessment || {}, message.identity || {}),
    TITAN_ZERO_HEARTBEAT: heartbeat
  };
  const handler = handlers[message?.type];
  if (!handler) return false;
  Promise.resolve().then(handler).then(state => sendResponse({ ok: true, state })).catch(error => sendResponse({ ok: false, error: String(error) }));
  return true;
});

boot().catch(() => {});
