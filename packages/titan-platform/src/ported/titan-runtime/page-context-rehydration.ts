// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/page-context-rehydration.mjs
export const TITAN_PAGE_REHYDRATION_SESSION_KEY = 'titanPageLauncherRehydrated';
export const TITAN_PAGE_REHYDRATION_MAX_CONCURRENCY = 4;

const eligibleUrl = (value) => /^(?:https?|file):\/\//i.test(String(value || ''));
const inFlightByChromeApi = new WeakMap();
let rehydrationRunSequence = 0;

async function runPageContextRehydration({ chromeApi = globalThis.chrome } = {}) {
  const session = chromeApi?.storage?.session;
  const queryTabs = chromeApi?.tabs?.query;
  const executeScript = chromeApi?.scripting?.executeScript;
  const authorityNeutral = Object.freeze({ authority_effect: false, grants_authority: false });
  if (!session?.get || !session?.set || typeof queryTabs !== 'function' || typeof executeScript !== 'function') {
    return Object.freeze({
      ok: false,
      skipped: true,
      reason: 'api-unavailable',
      attempted: 0,
      injected: 0,
      failed: 0,
      failed_tab_ids: Object.freeze([]),
      diagnostic_codes: Object.freeze(['page-context-rehydration-api-unavailable']),
      ...authorityNeutral,
    });
  }

  const version = String(chromeApi?.runtime?.getManifest?.()?.version || 'unknown');
  const existing = (await session.get(TITAN_PAGE_REHYDRATION_SESSION_KEY))?.[TITAN_PAGE_REHYDRATION_SESSION_KEY];
  const staleContextRecovered = Boolean(existing && String(existing.version || 'unknown') !== version);
  const effectiveExisting = staleContextRecovered ? null : existing;
  const pendingTabIds = Array.isArray(effectiveExisting?.pendingTabIds)
    ? effectiveExisting.pendingTabIds.filter(Number.isInteger)
    : [];
  const retryWakeBudget = Number.isInteger(effectiveExisting?.retryWakeBudget)
    ? Math.max(0, effectiveExisting.retryWakeBudget)
    : 0;
  const rehydrationRunId = `page-rehydrate-${version}-${++rehydrationRunSequence}`;

  if (effectiveExisting && (pendingTabIds.length === 0 || retryWakeBudget === 0)) {
    return Object.freeze({
      ok: true,
      skipped: true,
      reason: 'already-rehydrated',
      attempted: 0,
      injected: 0,
      failed: 0,
      version,
      stale_context_recovered: false,
      rehydration_run_id: rehydrationRunId,
      failed_tab_ids: Object.freeze([]),
      diagnostic_codes: Object.freeze([]),
      ...authorityNeutral,
    });
  }

  const tabs = await queryTabs.call(chromeApi.tabs, {});
  const retryIds = new Set(pendingTabIds);
  const candidates = (Array.isArray(tabs) ? tabs : []).filter((tab) => {
    if (!Number.isInteger(tab?.id) || !eligibleUrl(tab?.url)) return false;
    return effectiveExisting ? retryIds.has(tab.id) : true;
  });

  let attempted = 0;
  let injected = 0;
  let failed = 0;
  const failureByIndex = new Array(candidates.length).fill(false);
  let nextIndex = 0;
  const workerCount = Math.min(TITAN_PAGE_REHYDRATION_MAX_CONCURRENCY, candidates.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= candidates.length) return;
      const tab = candidates[index];
      attempted += 1;
      try {
        await executeScript.call(chromeApi.scripting, {
          target: { tabId: tab.id, allFrames: false },
          files: ['titan-launcher-overlay.js'],
        });
        injected += 1;
      } catch (_) {
        failed += 1;
        failureByIndex[index] = true;
      }
    }
  });
  await Promise.all(workers);
  const nextPending = candidates.filter((_, index) => failureByIndex[index]).map(tab => tab.id);

  const nextRetryWakeBudget = effectiveExisting
    ? Math.max(0, retryWakeBudget - 1)
    : (nextPending.length ? 2 : 0);
  const diagnosticCodes = [];
  if (staleContextRecovered) diagnosticCodes.push('stale-context-version-mismatch');
  if (nextPending.length) diagnosticCodes.push('page-context-rehydration-partial-failure');
  const failureCodes = nextPending.length ? ['page-context-injection-failed'] : [];
  await session.set({
    [TITAN_PAGE_REHYDRATION_SESSION_KEY]: {
      version,
      at: Date.now(),
      attempted,
      injected,
      failed,
      pendingTabIds: nextPending,
      retryWakeBudget: nextRetryWakeBudget,
      failureCodes,
      staleContextRecovered,
      rehydrationRunId,
    },
  });

  return Object.freeze({
    ok: true,
    skipped: false,
    attempted,
    injected,
    failed,
    version,
    pendingTabIds: Object.freeze([...nextPending]),
    retryWakeBudget: nextRetryWakeBudget,
    stale_context_recovered: staleContextRecovered,
    rehydration_run_id: rehydrationRunId,
    failed_tab_ids: Object.freeze([...nextPending]),
    diagnostic_codes: Object.freeze(diagnosticCodes),
    ...authorityNeutral,
  });
}

export function rehydrateTitanPageContextsOnce({ chromeApi = globalThis.chrome } = {}) {
  if (!chromeApi || (typeof chromeApi !== 'object' && typeof chromeApi !== 'function')) {
    return runPageContextRehydration({ chromeApi });
  }
  const existing = inFlightByChromeApi.get(chromeApi);
  if (existing) return existing;
  const run = runPageContextRehydration({ chromeApi });
  inFlightByChromeApi.set(chromeApi, run);
  void run.finally(() => {
    if (inFlightByChromeApi.get(chromeApi) === run) inFlightByChromeApi.delete(chromeApi);
  }).catch(() => {});
  return run;
}

if (globalThis.chrome?.storage?.session && globalThis.chrome?.tabs?.query && globalThis.chrome?.scripting?.executeScript) {
  void rehydrateTitanPageContextsOnce({ chromeApi: globalThis.chrome }).catch(() => {});
}
