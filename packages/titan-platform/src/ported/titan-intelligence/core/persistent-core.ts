// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/persistent-core.mjs
import { ZERO_KEYS, readLocal, writeLocal, updateLocal, timestamp } from './storage.js';
import { DEFAULT_RUNTIME, DEFAULT_CONTEXT, DEFAULT_WORKING_STATE, DEFAULT_MEMORY, DEFAULT_PREFERENCES, DEFAULT_KNOWLEDGE, DEFAULT_CAPABILITIES, DEFAULT_CONFIDENCE, DEFAULT_JOURNEYS, DEFAULT_INTELLIGENCE } from './defaults.js';
import { DEFAULT_PROCESSING, initialiseProcessingLifecycle, getProcessingState } from './processing-lifecycle.js';
import { DEFAULT_TEAM_A, getTeamAState } from './intelligence-team-a.js';
import { DEFAULT_TEAM_B, getTeamBState } from './intelligence-team-b.js';
import { DEFAULT_CONVERGENCE, getConvergenceState } from './convergence-intelligence.js';
import { DEFAULT_DIVERGENCE, getDivergenceState } from './divergence-intelligence.js';
import { DEFAULT_DIVERGENCE_SEVERITY, getDivergenceSeverityState } from './divergence-severity.js';

const bounded = (items, limit) => Array.isArray(items) ? items.slice(-limit) : [];
const cleanCompany = value => value == null || value === '' ? null : String(value);

export async function initialisePersistentCore() {
  const now = timestamp();
  const runtime = await readLocal(ZERO_KEYS.runtime, DEFAULT_RUNTIME);
  const nextRuntime = { ...DEFAULT_RUNTIME, ...runtime, startedAt: runtime.startedAt || now, lastWakeAt: now, updatedAt: now };
  await writeLocal(ZERO_KEYS.runtime, nextRuntime);
  const defaults = [[ZERO_KEYS.context, DEFAULT_CONTEXT],[ZERO_KEYS.workingState, DEFAULT_WORKING_STATE],[ZERO_KEYS.memory, DEFAULT_MEMORY],[ZERO_KEYS.preferences, DEFAULT_PREFERENCES],[ZERO_KEYS.knowledge, DEFAULT_KNOWLEDGE],[ZERO_KEYS.capabilities, DEFAULT_CAPABILITIES],[ZERO_KEYS.confidence, DEFAULT_CONFIDENCE],[ZERO_KEYS.journeys, DEFAULT_JOURNEYS],[ZERO_KEYS.intelligence, DEFAULT_INTELLIGENCE]];
  for (const [key, fallback] of defaults) {
    const stored = await readLocal(key, fallback);
    if (!stored.updatedAt) await writeLocal(key, { ...fallback, ...stored, updatedAt: now });
  }
  await initialiseProcessingLifecycle();
  const teamA = await readLocal(ZERO_KEYS.teamA, DEFAULT_TEAM_A);
  if (!teamA.updatedAt) await writeLocal(ZERO_KEYS.teamA, { ...DEFAULT_TEAM_A, ...teamA, updatedAt: now });
  const teamB = await readLocal(ZERO_KEYS.teamB, DEFAULT_TEAM_B);
  if (!teamB.updatedAt) await writeLocal(ZERO_KEYS.teamB, { ...DEFAULT_TEAM_B, ...teamB, updatedAt: now });
  const convergence = await readLocal(ZERO_KEYS.convergence, DEFAULT_CONVERGENCE);
  if (!convergence.updatedAt) await writeLocal(ZERO_KEYS.convergence, { ...DEFAULT_CONVERGENCE, ...convergence, updatedAt: now });
  const divergence = await readLocal(ZERO_KEYS.divergence, DEFAULT_DIVERGENCE);
  if (!divergence.updatedAt) await writeLocal(ZERO_KEYS.divergence, { ...DEFAULT_DIVERGENCE, ...divergence, updatedAt: now });
  const divergenceSeverity = await readLocal(ZERO_KEYS.divergenceSeverity, DEFAULT_DIVERGENCE_SEVERITY);
  if (!divergenceSeverity.updatedAt) await writeLocal(ZERO_KEYS.divergenceSeverity, { ...DEFAULT_DIVERGENCE_SEVERITY, ...divergenceSeverity, updatedAt: now });
  return nextRuntime;
}

export async function heartbeat() {
  return updateLocal(ZERO_KEYS.runtime, DEFAULT_RUNTIME, current => ({ ...DEFAULT_RUNTIME, ...current, status: 'ready', lastWakeAt: timestamp(), heartbeatAt: timestamp(), updatedAt: timestamp() }));
}

export async function getSnapshot() {
  const [runtime, context, workingState, memory, preferences, knowledge, capabilities, confidence, journeys, intelligence, processing, teamA, teamB, convergence, divergence, divergenceSeverity] = await Promise.all([
    readLocal(ZERO_KEYS.runtime, DEFAULT_RUNTIME), readLocal(ZERO_KEYS.context, DEFAULT_CONTEXT), readLocal(ZERO_KEYS.workingState, DEFAULT_WORKING_STATE), readLocal(ZERO_KEYS.memory, DEFAULT_MEMORY), readLocal(ZERO_KEYS.preferences, DEFAULT_PREFERENCES), readLocal(ZERO_KEYS.knowledge, DEFAULT_KNOWLEDGE), readLocal(ZERO_KEYS.capabilities, DEFAULT_CAPABILITIES), readLocal(ZERO_KEYS.confidence, DEFAULT_CONFIDENCE), readLocal(ZERO_KEYS.journeys, DEFAULT_JOURNEYS), readLocal(ZERO_KEYS.intelligence, DEFAULT_INTELLIGENCE), getProcessingState(), getTeamAState(), getTeamBState(), getConvergenceState(), getDivergenceState(), getDivergenceSeverityState()
  ]);
  return { runtime, context, workingState, memory, preferences, knowledge, capabilities, confidence, journeys, intelligence, processing, teamA, teamB, convergence, divergence, divergenceSeverity };
}

export async function setContext(patch = {}) {
  return updateLocal(ZERO_KEYS.context, DEFAULT_CONTEXT, current => {
    const safe = {};
    if ('actor' in patch) safe.actor = patch.actor;
    if ('company_id' in patch) safe.company_id = cleanCompany(patch.company_id);
    if ('activeTab' in patch) safe.activeTab = patch.activeTab;
    if ('activeEntity' in patch) safe.activeEntity = patch.activeEntity;
    if (Array.isArray(patch.recentSignals)) safe.recentSignals = bounded(patch.recentSignals, 50);
    return { ...current, ...safe, updatedAt: timestamp() };
  });
}

export async function patchWorkingState(patch = {}) {
  return updateLocal(ZERO_KEYS.workingState, DEFAULT_WORKING_STATE, current => ({ ...current, ...patch, activeTasks: bounded(patch.activeTasks ?? current.activeTasks, 100), pendingReviews: bounded(patch.pendingReviews ?? current.pendingReviews, 100), updatedAt: timestamp() }));
}

export async function remember(kind, entry) {
  const allowed = new Set(['episodic','semantic','procedural','preferences','signatures']);
  if (!allowed.has(kind)) throw new Error('unsupported-memory-kind');
  const item = { id: entry?.id || crypto.randomUUID(), ...entry, rememberedAt: entry?.rememberedAt || timestamp() };
  return updateLocal(ZERO_KEYS.memory, DEFAULT_MEMORY, current => ({ ...current, [kind]: bounded([...(current[kind] || []), item], 500), updatedAt: timestamp() }));
}

export async function setPreferences(patch = {}) {
  return updateLocal(ZERO_KEYS.preferences, DEFAULT_PREFERENCES, current => ({ ...current, ...patch, privacy: { ...current.privacy, ...(patch.privacy || {}) }, intelligence: { ...current.intelligence, ...(patch.intelligence || {}) }, interface: { ...current.interface, ...(patch.interface || {}) }, updatedAt: timestamp() }));
}

export async function addKnowledge(kind, entry) {
  const allowed = new Set(['facts','observations','relationships']);
  if (!allowed.has(kind)) throw new Error('unsupported-knowledge-kind');
  const item = { id: entry?.id || crypto.randomUUID(), ...entry, recordedAt: entry?.recordedAt || timestamp() };
  return updateLocal(ZERO_KEYS.knowledge, DEFAULT_KNOWLEDGE, current => ({ ...current, [kind]: bounded([...(current[kind] || []), item], 1000), updatedAt: timestamp() }));
}

export async function setCapabilities(next = {}) {
  return updateLocal(ZERO_KEYS.capabilities, DEFAULT_CAPABILITIES, current => ({ ...current, deterministic: [...new Set(next.deterministic ?? current.deterministic)], local: [...new Set(next.local ?? current.local)], connected: [...new Set(next.connected ?? current.connected)], discoveredAt: next.discoveredAt || timestamp(), updatedAt: timestamp() }));
}

export async function setConfidence(next = {}) {
  return updateLocal(ZERO_KEYS.confidence, DEFAULT_CONFIDENCE, current => ({ ...current, ...next, factors: bounded(next.factors ?? current.factors, 100), unresolved: bounded(next.unresolved ?? current.unresolved, 100), updatedAt: timestamp() }));
}

export async function upsertJourney(journey = {}) {
  if (!journey.id) throw new Error('journey-id-required');
  return updateLocal(ZERO_KEYS.journeys, DEFAULT_JOURNEYS, current => {
    const active = [...(current.active || [])];
    const index = active.findIndex(item => item.id === journey.id);
    const next = { ...(index >= 0 ? active[index] : {}), ...journey, updatedAt: timestamp() };
    if (index >= 0) active[index] = next; else active.push(next);
    return { ...current, active: bounded(active, 100), updatedAt: timestamp() };
  });
}

export async function accumulate(kind, entry) {
  const allowed = new Set(['conclusions','patterns','lessons']);
  if (!allowed.has(kind)) throw new Error('unsupported-intelligence-kind');
  const item = { id: entry?.id || crypto.randomUUID(), ...entry, accumulatedAt: entry?.accumulatedAt || timestamp() };
  return updateLocal(ZERO_KEYS.intelligence, DEFAULT_INTELLIGENCE, current => ({ ...current, [kind]: bounded([...(current[kind] || []), item], 500), updatedAt: timestamp() }));
}
