// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/defaults.mjs
export const DEFAULT_RUNTIME = Object.freeze({
  product: 'Titan BOS', surface: 'Titan Omni', overseer: 'Titan Zero',
  mode: 'offline-zero', status: 'ready', architectureVersion: 2,
  externalModelRequired: false, providerDependency: 'none',
  startedAt: 0, lastWakeAt: 0, heartbeatAt: 0, updatedAt: 0
});
export const DEFAULT_CONTEXT = Object.freeze({ actor: null, company_id: null, activeTab: null, activeEntity: null, recentSignals: [], updatedAt: 0 });
export const DEFAULT_WORKING_STATE = Object.freeze({ focus: null, activeTasks: [], pendingReviews: [], scratch: {}, updatedAt: 0 });
export const DEFAULT_MEMORY = Object.freeze({ episodic: [], semantic: [], procedural: [], preferences: [], signatures: [], updatedAt: 0 });
export const DEFAULT_PREFERENCES = Object.freeze({ privacy: { cloudAllowed: false }, intelligence: { preferLocal: true }, interface: {}, updatedAt: 0 });
export const DEFAULT_KNOWLEDGE = Object.freeze({ facts: [], observations: [], relationships: [], updatedAt: 0 });
export const DEFAULT_CAPABILITIES = Object.freeze({ deterministic: [], local: [], connected: [], discoveredAt: 0, updatedAt: 0 });
export const DEFAULT_CONFIDENCE = Object.freeze({ overall: null, factors: [], unresolved: [], updatedAt: 0 });
export const DEFAULT_JOURNEYS = Object.freeze({ active: [], recent: [], updatedAt: 0 });
export const DEFAULT_INTELLIGENCE = Object.freeze({ conclusions: [], patterns: [], lessons: [], updatedAt: 0 });
