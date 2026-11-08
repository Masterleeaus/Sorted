// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/event-ledger/event-types.mjs
export const TITAN_EVENT_CATEGORIES = Object.freeze([
  'observation',
  'decision',
  'approval',
  'command',
  'execution_result',
  'anomaly',
  'recovery',
  'outcome',
  'evidence',
  'authority',
  'signal',
  'system',
]);

export function assertEventCategory(value) {
  const category = String(value || '').trim();
  if (!TITAN_EVENT_CATEGORIES.includes(category)) {
    throw new Error(`event-category-not-allowed:${category}`);
  }
  return category;
}
