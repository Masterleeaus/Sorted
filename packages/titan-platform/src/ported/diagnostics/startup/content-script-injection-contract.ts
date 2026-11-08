// @ts-nocheck
// Ported from Titan Zero extension (portable-core): diagnostics/startup/content-script-injection-contract.mjs
export const CONTENT_SCRIPT_INJECTION_CONTRACT = Object.freeze({
  isolatedRetriever: Object.freeze({ file: 'content/all.iife.js', world: 'ISOLATED', runAt: 'document_start', allFrames: true }),
  mainRetriever: Object.freeze({ file: 'content-main/all.iife.js', world: 'MAIN', runAt: 'document_start', allFrames: true }),
  compatibility: Object.freeze({ file: 'titan-zero-chat-content.compat.js', world: 'ISOLATED', runAt: 'document_start', allFrames: true }),
  diagnosticsLauncher: Object.freeze({ files: ['titan-diagnostics-content.js', 'titan-launcher-overlay.js'], world: 'ISOLATED', runAt: 'document_end', allFrames: false }),
  guards: Object.freeze({
    mainInitialized: '__RTRVR_MAIN_WORLD_INITIALIZED__',
    mainBridge: '__RTRVR_MAIN_WORLD_LOCAL_BRIDGE_INSTALLED__',
    notificationInterceptor: '__RTRVR_NOTIFICATION_INTERCEPTOR_INSTALLED__',
    launcherOwnerAttribute: 'data-titan-zero-launcher'
  }),
  prohibitedBulkReinjectionTargets: Object.freeze(['content.js', 'content/all.iife.js', 'content-main/all.iife.js', 'titan-zero-chat-content.compat.js'])
});

export function normalizeContentScriptWorld(entry = {}) {
  return entry.world || 'ISOLATED';
}

export function findManifestRegistration(manifest, file) {
  return (manifest?.content_scripts || []).filter(entry => (entry.js || []).includes(file));
}

export function assertContentScriptInjectionContract({ manifest, mainSource, launcherSource, installHandlerSource = '' }) {
  const failures = [];
  const check = (condition, code) => { if (!condition) failures.push(code); };
  const isolated = findManifestRegistration(manifest, CONTENT_SCRIPT_INJECTION_CONTRACT.isolatedRetriever.file);
  const main = findManifestRegistration(manifest, CONTENT_SCRIPT_INJECTION_CONTRACT.mainRetriever.file);
  const compat = findManifestRegistration(manifest, CONTENT_SCRIPT_INJECTION_CONTRACT.compatibility.file);
  const launcher = (manifest?.content_scripts || []).filter(entry => CONTENT_SCRIPT_INJECTION_CONTRACT.diagnosticsLauncher.files.every(file => (entry.js || []).includes(file)));

  check(isolated.length === 1, 'isolated_retriever_registration_count');
  check(main.length === 1, 'main_retriever_registration_count');
  check(compat.length === 1, 'compat_registration_count');
  check(launcher.length === 1, 'launcher_registration_count');

  if (isolated[0]) {
    check(normalizeContentScriptWorld(isolated[0]) === 'ISOLATED', 'isolated_retriever_world');
    check(isolated[0].run_at === 'document_start', 'isolated_retriever_run_at');
    check(isolated[0].all_frames === true, 'isolated_retriever_all_frames');
  }
  if (main[0]) {
    check(normalizeContentScriptWorld(main[0]) === 'MAIN', 'main_retriever_world');
    check(main[0].run_at === 'document_start', 'main_retriever_run_at');
    check(main[0].all_frames === true, 'main_retriever_all_frames');
  }
  if (compat[0]) {
    check(normalizeContentScriptWorld(compat[0]) === 'ISOLATED', 'compat_world');
    check(compat[0].run_at === 'document_start', 'compat_run_at');
  }
  if (launcher[0]) {
    check(normalizeContentScriptWorld(launcher[0]) === 'ISOLATED', 'launcher_world');
    check(launcher[0].run_at === 'document_end', 'launcher_run_at');
  }

  check(mainSource.includes(CONTENT_SCRIPT_INJECTION_CONTRACT.guards.mainInitialized), 'main_initialized_guard_missing');
  check(mainSource.includes(CONTENT_SCRIPT_INJECTION_CONTRACT.guards.mainBridge), 'main_bridge_guard_missing');
  check(mainSource.includes(CONTENT_SCRIPT_INJECTION_CONTRACT.guards.notificationInterceptor), 'notification_guard_missing');
  check(launcherSource.includes(CONTENT_SCRIPT_INJECTION_CONTRACT.guards.launcherOwnerAttribute), 'launcher_owner_guard_missing');

  for (const target of CONTENT_SCRIPT_INJECTION_CONTRACT.prohibitedBulkReinjectionTargets) {
    check(!installHandlerSource.includes(`files:["${target}"]`) && !installHandlerSource.includes(`files: ['${target}']`) && !installHandlerSource.includes(`files: [\"${target}\"]`), `bulk_reinjection_${target}`);
  }

  return Object.freeze({ ok: failures.length === 0, failures: Object.freeze(failures) });
}
