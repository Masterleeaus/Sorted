// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-modules/module-host.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import {
  normalizeModuleManifest,
  resolveModuleIntent,
  applyIntentTransform,
  listModuleContributions,
  getModuleContribution,
  moduleAppliesToCompany,
  CONTRIBUTION_TYPES,
} from './module-registry.js';
import {executeWorkflow} from './workflow-runtime.js';
import {resolveDependencies as resolveModuleDependencies} from './dependency-resolver.js';
import {assertExecutionAuthority} from './authority.js';
import {createEventBus} from './event-bus.js';
import {normalizeModuleBundle} from './bundle-runtime.js';
import {PACKAGED_MODULES} from './packaged-catalog.js';
import {verifySignedPackage} from './package-runtime.js';
import {createGovernanceGrantStore} from './governance-grants.js';
import {createModuleHistoryStore} from './lifecycle-history.js';
import {createMarketplaceRuntime} from './marketplace-runtime.js';
import {createModuleManager} from './module-manager.js';
import {buildCapabilityRegistry, getCapability, findCapabilities} from '../titan-capabilities/capability-registry.js';
import {routeIntentToCapabilities, INTENT_CAPABILITY_ROUTER_VERSION} from '../titan-capabilities/intent-capability-router.js';
import {assertLifecycleActionSender} from './lifecycle-access.js';
import {
  MODULE_RUNTIME_VERSION,
  assertRuntimeCompatibility,
  createFailureState,
  recordRuntimeFailure,
  clearRuntimeFailures,
  isRuntimeQuarantined,
  withLifecycleTimeout,
} from './runtime-policy.js';

const INSTALLED_KEY = 'titanInstalledModules';
const STATES_KEY = 'titanModuleStates';
const BUNDLES_KEY = 'titanInstalledModuleBundles';
const LOG_KEY = 'titanDiagnosticLog';
const SETTINGS_PREFIX = 'titanModuleSettings';
const DATA_PREFIX = 'titanModuleData';
const INSTALL_HISTORY_KEY = 'titanModuleInstallHistory';
const INSTALL_SNAPSHOTS_KEY = 'titanModuleInstallSnapshots';
const MAX_INSTALL_HISTORY = 100;
const MAX_INSTALL_SNAPSHOTS = 30;
const MAX_LOG = 1000;
const MAX_EVENT_DEPTH = 8;
const records = new Map();
const commandHandlers = new Map();
const queryHandlers = new Map();
const toolHandlers = new Map();
const providerHandlers = new Map();
const projectionHandlers = new Map();
const eventHandlers = new Map();
const diagnostics = new Map();
const disposers = new Map();
let dependencyState = {ok:true,order:[],blocked:{}};
const moduleEventBus = createEventBus({storage:chrome.storage.local,maxEvents:200});
const governanceGrants = createGovernanceGrantStore({storage:chrome.storage.local});
const lifecycleHistory = createModuleHistoryStore({storage:chrome.storage.local,maxEntries:5});
const companyModuleManager = createModuleManager({storage:chrome.storage.local});
const RESOLVED_AUTHORITY = Symbol('titanResolvedAuthority');
let trustedPublishersCache = null;
let readyResolve;
const ready = new Promise(resolve => { readyResolve = resolve; });

const safe = value => { try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); } };
const keyFor = (moduleId, id) => `${moduleId}:${String(id)}`;

const titanZeroVersion = () => {
  try { return chrome.runtime.getManifest?.()?.version || null; } catch { return null; }
};

function ensureRuntimeState(record) {
  if (!record.runtimeState) record.runtimeState = createFailureState();
  return record.runtimeState;
}

function markRuntimeFailure(record, error) {
  record.runtimeState = recordRuntimeFailure(ensureRuntimeState(record), record.manifest.runtime, error);
  if (isRuntimeQuarantined(record.runtimeState)) {
    record.status = 'quarantined';
    record.error = record.runtimeState.last_error;
  }
  return record.runtimeState;
}

async function guardRuntimeExecution(record, label, fn) {
  try { return await fn(); }
  catch (error) {
    markRuntimeFailure(record, error);
    await diag('warn', 'Module runtime execution failed', {id:record.manifest.id,label,error:String(error?.message||error),runtimeState:safe(record.runtimeState)});
    throw error;
  }
}

async function fetchJsonResource(path) {
  const response=await fetch(chrome.runtime.getURL(path));
  if(!response.ok) throw new Error(`Resource unavailable (${response.status}): ${path}`);
  return response.json();
}

async function getTrustedPublishers() {
  if(trustedPublishersCache) return trustedPublishersCache;
  const registry=await fetchJsonResource('titan-modules/trusted-publishers.json');
  if(registry?.schema!=='titan-trusted-publishers/v1'||!Array.isArray(registry.publishers)) throw new Error('Trusted publisher registry is invalid');
  const mapped={};
  for(const publisher of registry.publishers){
    const id=String(publisher?.id||'').trim().toLowerCase();if(!id)continue;
    mapped[id]={keys:Object.fromEntries((publisher.keys||[]).map(key=>[String(key.id),safe(key.jwk)]))};
  }
  trustedPublishersCache=mapped;
  return mapped;
}

async function verifyPackageEnvelope(envelope){
  return verifySignedPackage(envelope,{trustedPublishers:await getTrustedPublishers()});
}

const marketplaceRuntime=createMarketplaceRuntime({
  fetchJson:fetchJsonResource,
  verifyPackage:verifyPackageEnvelope,
  installModule:(payload,options)=>installManifest(payload,options),
  installBundle:(payload,options)=>installBundle(payload,options),
});

async function diag(level, message, detail={}) {
  try {
    const data = await chrome.storage.local.get([LOG_KEY]);
    const log = Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
    log.push({ts:new Date().toISOString(), level, source:'module-host', message, detail:safe(detail)});
    await chrome.storage.local.set({[LOG_KEY]:log.slice(-MAX_LOG)});
  } catch (_) {}
}

function registerOwned(map, moduleId, id, fn, label) {
  if (typeof fn !== 'function') throw new Error(`${label} handler must be a function`);
  const key = keyFor(moduleId, id);
  map.set(key, fn);
  return () => map.delete(key);
}

function moduleApi(moduleId) {
  return Object.freeze({
    registerHandler(command, fn) { return registerOwned(commandHandlers, moduleId, command, fn, 'Module command'); },
    registerQuery(id, fn) { return registerOwned(queryHandlers, moduleId, id, fn, 'Module query'); },
    registerTool(id, fn) { return registerOwned(toolHandlers, moduleId, id, fn, 'Module tool'); },
    registerProvider(id, fn) { return registerOwned(providerHandlers, moduleId, id, fn, 'Module provider'); },
    registerProjection(id, fn) { return registerOwned(projectionHandlers, moduleId, id, fn, 'Module projection'); },
    registerEvent(type, fn) { return registerOwned(eventHandlers, moduleId, type, fn, 'Module event'); },
    registerDiagnostic(name, fn) { return registerOwned(diagnostics, moduleId, name, fn, 'Module diagnostic'); },
    async publishEvent(type, payload={}, company_id=null, context={}) { return publishModuleEvent(moduleId,type,payload,company_id,context); },
    async getStorage(key) {
      const storageKey = `${DATA_PREFIX}:${moduleId}:${String(key)}`;
      const data = await chrome.storage.local.get([storageKey]);
      return safe(data[storageKey]);
    },
    async setStorage(key, value) {
      const storageKey = `${DATA_PREFIX}:${moduleId}:${String(key)}`;
      await chrome.storage.local.set({[storageKey]:safe(value)});
    },
    async getSettings(company_id=null) {
      const record = records.get(moduleId);
      if (!record) throw new Error(`Unknown module: ${moduleId}`);
      return getSettingsForRecord(record, company_id);
    },
    log(level, message, detail={}) { return diag(level, `[${moduleId}] ${message}`, detail); },
  });
}

function clearModuleRegistrations(moduleId) {
  const prefix = `${moduleId}:`;
  for (const map of [commandHandlers, queryHandlers, toolHandlers, providerHandlers, projectionHandlers, eventHandlers, diagnostics]) {
    for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
  }
}

async function getStates() {
  const data = await chrome.storage.local.get([STATES_KEY]);
  return data[STATES_KEY] && typeof data[STATES_KEY] === 'object' ? data[STATES_KEY] : {};
}

async function persistState(id, enabled) {
  const states = await getStates();
  states[id] = {enabled:Boolean(enabled), updatedAt:Date.now()};
  await chrome.storage.local.set({[STATES_KEY]:states});
}

async function activatePackagedRuntime(record) {
  clearModuleRegistrations(record.manifest.id);
  assertRuntimeCompatibility(record.manifest, MODULE_RUNTIME_VERSION, titanZeroVersion());
  const runtimeModule = PACKAGED_MODULES[record.manifest.id];
  if (!runtimeModule) throw new Error(`Packaged module ${record.manifest.id} is missing from packaged-catalog.mjs`);
  if (typeof runtimeModule.activate !== 'function') throw new Error('Packaged module must export activate(api, manifest)');
  try {
    const disposer = await withLifecycleTimeout(
      () => runtimeModule.activate(moduleApi(record.manifest.id), safe(record.manifest)),
      record.manifest.runtime.lifecycle.activation_timeout_ms,
      `${record.manifest.id} activation`,
    );
    if (typeof disposer === 'function') disposers.set(record.manifest.id, disposer);
    record.runtimeState = clearRuntimeFailures(ensureRuntimeState(record));
    record.status = 'active';
    record.error = null;
    await diag('info', 'Packaged module activated', {id:record.manifest.id, version:record.manifest.version, runtimeVersion:MODULE_RUNTIME_VERSION});
  } catch (error) {
    markRuntimeFailure(record, error);
    throw error;
  }
}

async function deactivatePackagedRuntime(record) {
  const disposer = disposers.get(record.manifest.id);
  if (typeof disposer === 'function') {
    try {
      await withLifecycleTimeout(
        () => disposer(),
        record.manifest.runtime.lifecycle.deactivation_timeout_ms,
        `${record.manifest.id} deactivation`,
      );
    } catch (error) {
      markRuntimeFailure(record, error);
      await diag('warn', 'Module disposer failed', {id:record.manifest.id,error:String(error?.message||error),runtimeState:safe(record.runtimeState)});
    }
  }
  disposers.delete(record.manifest.id);
  clearModuleRegistrations(record.manifest.id);
  if (!isRuntimeQuarantined(record.runtimeState)) record.status = 'disabled';
}

async function loadPackagedDescriptor(descriptor, states) {
  const manifestUrl = chrome.runtime.getURL(descriptor.manifest);
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`Manifest fetch failed (${response.status}) for ${descriptor.id || descriptor.manifest}`);
  const manifest = normalizeModuleManifest(await response.json(), {source:'packaged'});
  if (manifest.kind !== 'packaged') throw new Error(`${manifest.id} must declare kind=packaged`);
  if (descriptor.id && descriptor.id !== manifest.id) throw new Error(`Module id mismatch: ${descriptor.id} vs ${manifest.id}`);
  const enabled = states[manifest.id]?.enabled ?? descriptor.enabled !== false;
  const record = {manifest, enabled, source:'packaged', entry:descriptor.entry, descriptor:safe(descriptor), status:enabled?'loaded':'disabled', error:null, dependencyErrors:[], runtimeState:createFailureState()};
  records.set(manifest.id, record);
  return record;
}

async function loadPackagedModules(states) {
  const response = await fetch(chrome.runtime.getURL('titan-modules/index.json'));
  if (!response.ok) throw new Error(`Module index unavailable (${response.status})`);
  const index = await response.json();
  for (const descriptor of index.modules || []) {
    try { await loadPackagedDescriptor(descriptor, states); }
    catch (error) { await diag('error', 'Packaged module load failed', {descriptor, error:String(error?.message || error)}); }
  }
}

async function getInstalledDeclarative() {
  const data = await chrome.storage.local.get([INSTALLED_KEY]);
  return Array.isArray(data[INSTALLED_KEY]) ? data[INSTALLED_KEY] : [];
}

async function saveInstalledDeclarative(items) {
  await chrome.storage.local.set({[INSTALLED_KEY]:items.map(item => safe(item))});
}

async function getInstalledBundles() {
  const data=await chrome.storage.local.get([BUNDLES_KEY]);
  return Array.isArray(data[BUNDLES_KEY]) ? data[BUNDLES_KEY] : [];
}

function publicBundle(bundle) {
  return {id:bundle.id,name:bundle.name,version:bundle.version,pack_type:bundle.pack_type,description:bundle.description||'',state:bundle.state||'enabled',authority:safe(bundle.authority||{activation_confers_authority:false,requests:[]}),moduleIds:safe(bundle.moduleIds||[]),installedAt:bundle.installedAt||null,updatedAt:bundle.updatedAt||null,metadata:safe(bundle.metadata||{})};
}

async function loadDeclarativeModules(states) {
  for (const raw of await getInstalledDeclarative()) {
    try {
      const manifest = normalizeModuleManifest(raw, {source:'installed'});
      if (manifest.kind !== 'declarative') throw new Error('Only declarative manifests can be installed at runtime');
      assertRuntimeCompatibility(manifest, MODULE_RUNTIME_VERSION, titanZeroVersion());
      records.set(manifest.id, {manifest, enabled:states[manifest.id]?.enabled ?? true, source:'installed', status:'active', error:null, dependencyErrors:[], runtimeState:createFailureState()});
    } catch (error) {
      await diag('error', 'Installed module rejected during startup', {id:raw?.id, error:String(error?.message || error)});
    }
  }
}

async function refreshDependencyState() {
  dependencyState = resolveModuleDependencies([...records.values()]);
  for (const record of records.values()) {
    const errors = dependencyState.blocked[record.manifest.id] || [];
    record.dependencyErrors = safe(errors);
    if (isRuntimeQuarantined(ensureRuntimeState(record))) {
      if (record.source === 'packaged' && disposers.has(record.manifest.id)) await deactivatePackagedRuntime(record);
      record.status = 'quarantined';
      record.error = record.runtimeState.last_error;
      continue;
    }
    if (!record.enabled) {
      if (record.source === 'packaged' && record.status === 'active') await deactivatePackagedRuntime(record);
      record.status = 'disabled';
      record.error = null;
      continue;
    }
    if (errors.length) {
      if (record.source === 'packaged' && record.status === 'active') await deactivatePackagedRuntime(record);
      record.status = 'blocked';
      record.error = null;
      continue;
    }
    if (record.source === 'installed') {
      record.status = 'active';
      record.error = null;
      continue;
    }
    if (record.source === 'packaged' && record.status !== 'active') {
      try { await activatePackagedRuntime(record); }
      catch (error) {
        record.status = isRuntimeQuarantined(record.runtimeState) ? 'quarantined' : 'error';
        record.error = String(error?.message || error);
        await diag('error','Packaged module activation failed',{id:record.manifest.id,error:record.error,stack:error?.stack,runtimeState:safe(record.runtimeState)});
      }
    }
  }
  return dependencyState;
}

async function initialize() {
  try {
    const states = await getStates();
    await loadPackagedModules(states);
    await loadDeclarativeModules(states);
    await refreshDependencyState();
    await diag('info', 'Module host ready', {modules:records.size,dependencies:dependencyState});
  } catch (error) {
    await diag('error', 'Module host initialization failed', {error:String(error?.message || error), stack:error?.stack});
  } finally { readyResolve(); }
}

function contributionCounts(manifest) {
  return Object.fromEntries(CONTRIBUTION_TYPES.map(type => [type, Array.isArray(manifest.contributes?.[type]) ? manifest.contributes[type].length : 0]));
}

function publicRecord(record) {
  return {
    id:record.manifest.id, name:record.manifest.name, version:record.manifest.version,
    kind:record.manifest.kind, description:record.manifest.description, source:record.source,
    enabled:record.enabled, status:record.status, error:record.error, dependencyErrors:safe(record.dependencyErrors||[]),
    scope:record.manifest.scope, requires:safe(record.manifest.requires||{modules:[]}), authority:safe(record.manifest.authority||{activation_confers_authority:false,requests:[]}), runtime:safe(record.manifest.runtime), runtimeState:safe(ensureRuntimeState(record)), contributes:safe(record.manifest.contributes),
    metadata:safe(record.manifest.metadata||{}), packageVerification:safe(record.manifest.metadata?.package_verification||null),
    contributionCounts:contributionCounts(record.manifest),
  };
}

function getRecord(id, {enabled=true}={}) {
  const record = records.get(String(id || '').toLowerCase());
  if (!record) throw new Error(`Unknown module: ${id}`);
  if (enabled && !record.enabled) throw new Error(`Module is disabled: ${id}`);
  if (enabled && record.status === 'blocked') throw new Error(`Module is blocked by dependencies: ${id}: ${(record.dependencyErrors||[]).join('; ')}`);
  if (enabled && record.status === 'quarantined') throw new Error(`Module is quarantined after repeated runtime failures: ${id}: ${record.runtimeState?.last_error||record.error||'unknown error'}`);
  if (enabled && record.status === 'error') throw new Error(`Module is in error state: ${id}: ${record.error||'unknown error'}`);
  return record;
}

function companyForRecord(record, company_id=null) {
  const scoped = record.manifest.scope?.company_id || null;
  if (scoped && company_id != null && String(company_id) !== String(scoped)) throw new Error(`Module ${record.manifest.id} is scoped to a different company_id`);
  return scoped || (company_id == null || company_id === '' ? null : String(company_id));
}

function assertCompanyAccess(record, company_id=null) {
  const resolved = companyForRecord(record, company_id);
  if (!moduleAppliesToCompany(record.manifest, resolved)) throw new Error(`Module ${record.manifest.id} is not available for company_id ${company_id ?? '(none)'}`);
  return resolved;
}

async function assertCompanyEnabled(record, company_id=null) {
  const resolved = assertCompanyAccess(record, company_id);
  if (resolved && !(await companyModuleManager.isEnabled(record, resolved))) throw new Error(`Module ${record.manifest.id} is disabled for company_id ${resolved}`);
  return resolved;
}

async function publicCompanyRecord(record, company_id) {
  const company = String(company_id || '').trim();
  const base = publicRecord(record);
  const state = await companyModuleManager.getState(record.manifest.id, company);
  const resolution = await companyModuleManager.resolve([...records.values()], company);
  const companyEnabled = await companyModuleManager.isEnabled(record, company);
  const dependencyErrors = safe(resolution.blocked[record.manifest.id] || []);
  const runtimeUnavailable = ['quarantined','error'].includes(base.status);
  return {...base, company_id:company, companyEnabled:companyEnabled && !runtimeUnavailable, companyConfig:safe(state.config || {}), companyUpdatedAt:state.updatedAt || 0, companyStatus:runtimeUnavailable?base.status:!companyEnabled?'disabled':dependencyErrors.length?'blocked':base.status, companyDependencyErrors:dependencyErrors};
}

async function getInstallHistory() {
  const data = await chrome.storage.local.get([INSTALL_HISTORY_KEY]);
  return Array.isArray(data[INSTALL_HISTORY_KEY]) ? data[INSTALL_HISTORY_KEY] : [];
}

async function getInstallSnapshots() {
  const data = await chrome.storage.local.get([INSTALL_SNAPSHOTS_KEY]);
  return Array.isArray(data[INSTALL_SNAPSHOTS_KEY]) ? data[INSTALL_SNAPSHOTS_KEY] : [];
}

function newInstallId(prefix='install') {
  const rand = Math.random().toString(36).slice(2,10);
  return `${prefix}-${Date.now()}-${rand}`;
}

async function snapshotInstallationState(reason, detail={}) {
  const [installed,bundles,states,snapshots] = await Promise.all([getInstalledDeclarative(), getInstalledBundles(), getStates(), getInstallSnapshots()]);
  const snapshot={id:newInstallId('snapshot'),createdAt:new Date().toISOString(),reason:String(reason||'module-change'),detail:safe(detail),installed:safe(installed),bundles:safe(bundles),states:safe(states)};
  await chrome.storage.local.set({[INSTALL_SNAPSHOTS_KEY]:[...snapshots,snapshot].slice(-MAX_INSTALL_SNAPSHOTS)});
  return snapshot;
}

async function recordInstallEvent(event) {
  const history=await getInstallHistory();
  const item={id:newInstallId('event'),ts:new Date().toISOString(),status:'committed',...safe(event)};
  await chrome.storage.local.set({[INSTALL_HISTORY_KEY]:[...history,item].slice(-MAX_INSTALL_HISTORY)});
  return item;
}

async function reloadInstalledStateFromStorage() {
  for (const [id,record] of [...records.entries()]) if (record.source==='installed') { clearModuleRegistrations(id); records.delete(id); }
  const states=await getStates();
  for (const record of records.values()) if(record.source==='packaged') record.enabled=states[record.manifest.id]?.enabled ?? record.descriptor?.enabled !== false;
  await loadDeclarativeModules(states);
  const bundles=await getInstalledBundles();
  for(const bundle of bundles) for(const moduleId of bundle.moduleIds||[]){const record=records.get(String(moduleId).toLowerCase());if(record?.source==='installed')record.bundleId=String(bundle.id||'').toLowerCase()||null;}
  await refreshDependencyState();
}

async function restoreInstallationSnapshot(snapshotId) {
  const snapshots=await getInstallSnapshots();
  const snapshot=snapshots.find(item=>item.id===String(snapshotId||''));
  if(!snapshot) throw new Error(`Installation snapshot not found: ${snapshotId}`);
  await chrome.storage.local.set({[INSTALLED_KEY]:safe(snapshot.installed||[]),[BUNDLES_KEY]:safe(snapshot.bundles||[]),[STATES_KEY]:safe(snapshot.states||{})});
  await reloadInstalledStateFromStorage();
  const event=await recordInstallEvent({action:'rollback',snapshotId:snapshot.id,reason:snapshot.reason,detail:safe(snapshot.detail||{})});
  await diag('info','Module installation rollback applied',{snapshotId:snapshot.id,reason:snapshot.reason});
  return {snapshot:{id:snapshot.id,createdAt:snapshot.createdAt,reason:snapshot.reason,detail:safe(snapshot.detail||{})},event};
}

function findBundleOwner(moduleId,bundles){const id=String(moduleId||'').toLowerCase();return bundles.find(bundle=>(bundle.moduleIds||[]).some(item=>String(item).toLowerCase()===id))||null;}

async function validateManifestInstall(raw) {
  const manifest=normalizeModuleManifest(raw,{source:'installed'});
  if(manifest.kind!=='declarative') throw new Error('Remote executable modules are not permitted. Runtime installs must use kind=declarative; packaged code modules must ship inside the extension.');
  assertRuntimeCompatibility(manifest,MODULE_RUNTIME_VERSION,titanZeroVersion());
  const existing=records.get(manifest.id)||null;
  if(existing?.source==='packaged') throw new Error(`Packaged module ${manifest.id} cannot be replaced by a runtime install`);
  const bundles=await getInstalledBundles();
  const owner=findBundleOwner(manifest.id,bundles); if(owner) throw new Error(`Module ${manifest.id} belongs to bundle ${owner.id}; update the bundle instead`);
  const baseline=resolveModuleDependencies([...records.values()]);
  const candidate=[...records.values()].filter(record=>record.manifest.id!==manifest.id);
  candidate.push({manifest,enabled:existing?.enabled??true,source:'installed',status:'active'});
  const resolved=resolveModuleDependencies(candidate),newBlocks=[];
  for(const [id,errors] of Object.entries(resolved.blocked||{})){const prior=new Set(baseline.blocked?.[id]||[]);for(const error of errors||[])if(!prior.has(error))newBlocks.push(`${id}: ${error}`);}
  const externalBreaks=newBlocks.filter(message=>!message.startsWith(`${manifest.id}:`)); if(externalBreaks.length)throw new Error(`Module dependency preflight failed: ${externalBreaks.join('; ')}`);
  const dependencyWarnings=safe(resolved.blocked?.[manifest.id]||[]),action=!existing?'install':existing.manifest.version===manifest.version?'reinstall':'update';
  return {valid:true,action,module:publicRecord({manifest,enabled:existing?.enabled??true,source:'installed',status:dependencyWarnings.length?'blocked':'active',error:null,dependencyErrors:dependencyWarnings,runtimeState:createFailureState()}),previousVersion:existing?.manifest.version||null,runtimeVersion:MODULE_RUNTIME_VERSION,
    intentCapabilityRouterVersion:INTENT_CAPABILITY_ROUTER_VERSION,titanZeroVersion:titanZeroVersion(),dependencyWarnings,dependencyState:safe(resolved)};
}

async function validateBundleInstall(raw) {
  const bundle=normalizeModuleBundle(raw),installedBundles=await getInstalledBundles(),priorBundle=installedBundles.find(item=>String(item?.id||'').toLowerCase()===bundle.id)||null,priorIds=new Set((priorBundle?.moduleIds||[]).map(id=>String(id).toLowerCase()));
  for(const manifest of bundle.modules)assertRuntimeCompatibility(manifest,MODULE_RUNTIME_VERSION,titanZeroVersion());
  for(const manifest of bundle.modules){const existing=records.get(manifest.id);if(existing&&!priorIds.has(manifest.id))throw new Error(`Bundle module collision: ${manifest.id} is already installed outside bundle ${bundle.id}`);const owner=findBundleOwner(manifest.id,installedBundles.filter(item=>String(item?.id||'').toLowerCase()!==bundle.id));if(owner)throw new Error(`Bundle module collision: ${manifest.id} belongs to bundle ${owner.id}`);}
  const candidates=[...records.values()].filter(record=>!priorIds.has(record.manifest.id));for(const manifest of bundle.modules)candidates.push({manifest,enabled:true,source:'installed',status:'active'});
  const resolved=resolveModuleDependencies(candidates),blocked=bundle.modules.flatMap(manifest=>(resolved.blocked?.[manifest.id]||[]).map(error=>`${manifest.id}: ${error}`));if(blocked.length)throw new Error(`Bundle dependency preflight failed: ${blocked.join('; ')}`);
  return {valid:true,action:priorBundle?'update':'install',bundle:publicBundle({...bundle,moduleIds:bundle.modules.map(m=>m.id)}),previousVersion:priorBundle?.version||null,runtimeVersion:MODULE_RUNTIME_VERSION,
    intentCapabilityRouterVersion:INTENT_CAPABILITY_ROUTER_VERSION,titanZeroVersion:titanZeroVersion(),dependencyState:safe(resolved)};
}

async function installManifest(raw, options={}) {
  const packageVerification=options?.packageVerification||null;
  const candidate=packageVerification?{...safe(raw),metadata:{...(raw?.metadata&&typeof raw.metadata==='object'?safe(raw.metadata):{}),package_verification:{verified:true,publisher_id:packageVerification.publisher_id,key_id:packageVerification.key_id,digest:packageVerification.digest,installed_via:'signed-package'}}}:raw;
  const validation=await validateManifestInstall(candidate);
  const manifest=normalizeModuleManifest(candidate,{source:'installed'});
  const prior=records.get(manifest.id);
  const snapshot=await snapshotInstallationState(`manifest-${validation.action}`,{moduleId:manifest.id,version:manifest.version,previousVersion:validation.previousVersion});
  try {
    if(options.recordHistory!==false && prior?.source==='installed' && prior.manifest.version!==manifest.version) await lifecycleHistory.pushModule({id:prior.manifest.id,version:prior.manifest.version,manifest:safe(prior.manifest),enabled:Boolean(prior.enabled),status:prior.status,source:prior.source});
    const installed=await getInstalledDeclarative(),next=installed.filter(item=>String(item?.id||'').toLowerCase()!==manifest.id);next.push(manifest);await saveInstalledDeclarative(next);
    const states=await getStates();const record={manifest,enabled:states[manifest.id]?.enabled??prior?.enabled??true,source:'installed',status:'active',error:null,dependencyErrors:[],runtimeState:createFailureState()};records.set(manifest.id,record);await refreshDependencyState();
    await recordInstallEvent({action:validation.action,moduleId:manifest.id,version:manifest.version,previousVersion:validation.previousVersion,snapshotId:snapshot.id,verified:Boolean(packageVerification)});
    await diag('info','Declarative module installation committed',{id:manifest.id,version:manifest.version,verified:Boolean(packageVerification),snapshotId:snapshot.id,contributions:contributionCounts(manifest),dependencyErrors:record.dependencyErrors});
    return publicRecord(record);
  } catch(error) { await restoreInstallationSnapshot(snapshot.id); await diag('error','Declarative module installation reverted',{id:manifest.id,error:String(error?.message||error),snapshotId:snapshot.id}); throw error; }
}

async function installBundle(raw, options={}) {
  const packageVerification=options?.packageVerification||null;
  const verificationMetadata=packageVerification?{verified:true,publisher_id:packageVerification.publisher_id,key_id:packageVerification.key_id,digest:packageVerification.digest,installed_via:'signed-package'}:null;
  const candidate=packageVerification?{...safe(raw),metadata:{...(raw?.metadata&&typeof raw.metadata==='object'?safe(raw.metadata):{}),package_verification:verificationMetadata},modules:(Array.isArray(raw?.modules)?raw.modules:[]).map(module=>({...safe(module),metadata:{...(module?.metadata&&typeof module.metadata==='object'?safe(module.metadata):{}),package_verification:verificationMetadata,package_bundle_id:String(raw?.id||'')}}))}:raw;
  const validation=await validateBundleInstall(candidate);
  const bundle=normalizeModuleBundle(candidate);
  const snapshot=await snapshotInstallationState(`bundle-${validation.action}`,{bundleId:bundle.id,version:bundle.version,previousVersion:validation.previousVersion});
  try {
    const installedBundles=await getInstalledBundles();
    const priorBundle=installedBundles.find(item=>String(item?.id||'').toLowerCase()===bundle.id)||null;
    const priorIds=new Set((priorBundle?.moduleIds||[]).map(id=>String(id).toLowerCase()));
    const installedBefore=await getInstalledDeclarative();
    if(options.recordHistory!==false && priorBundle && priorBundle.version!==bundle.version){const priorModules=installedBefore.filter(item=>priorIds.has(String(item?.id||'').toLowerCase()));const states=await getStates();await lifecycleHistory.pushBundle({id:priorBundle.id,version:priorBundle.version,bundle:{schema:'titan-module-bundle/v1',id:priorBundle.id,name:priorBundle.name,version:priorBundle.version,pack_type:priorBundle.pack_type,description:priorBundle.description||'',authority:safe(priorBundle.authority||{}),modules:safe(priorModules),metadata:safe(priorBundle.metadata||{})},state:priorBundle.state||'enabled',moduleStates:Object.fromEntries([...priorIds].map(id=>[id,states[id]?.enabled??records.get(id)?.enabled??true]))});}
    const replaceIds=new Set([...priorIds,...bundle.modules.map(manifest=>manifest.id)]),nextInstalled=installedBefore.filter(item=>!replaceIds.has(String(item?.id||'').toLowerCase())).concat(bundle.modules.map(safe));
    const bundleState=priorBundle?.state||'enabled';
    const bundleRecord=publicBundle({...bundle,moduleIds:bundle.modules.map(manifest=>manifest.id),state:bundleState,installedAt:priorBundle?.installedAt||new Date().toISOString(),updatedAt:new Date().toISOString()});
    const nextBundles=installedBundles.filter(item=>String(item?.id||'').toLowerCase()!==bundle.id).concat(bundleRecord);
    await chrome.storage.local.set({[INSTALLED_KEY]:safe(nextInstalled),[BUNDLES_KEY]:safe(nextBundles)});
    for(const id of priorIds)if(!bundle.modules.some(manifest=>manifest.id===id)){clearModuleRegistrations(id);records.delete(id);}
    const states=await getStates();
    for(const manifest of bundle.modules){const enabled=bundleState!=='suspended'&&(states[manifest.id]?.enabled??true);records.set(manifest.id,{manifest,enabled,source:'installed',status:enabled?'active':'disabled',error:null,dependencyErrors:[],bundleId:bundle.id,runtimeState:createFailureState()});if(bundleState==='suspended')await persistState(manifest.id,false);}
    await refreshDependencyState();
    const event=await recordInstallEvent({action:validation.action,bundleId:bundle.id,version:bundle.version,previousVersion:validation.previousVersion,snapshotId:snapshot.id,moduleIds:bundle.modules.map(manifest=>manifest.id),verified:Boolean(packageVerification)});
    await diag('info','Module bundle installation committed',{id:bundle.id,version:bundle.version,pack_type:bundle.pack_type,state:bundleState,verified:Boolean(packageVerification),snapshotId:snapshot.id,moduleIds:bundle.modules.map(manifest=>manifest.id)});
    return {bundle:bundleRecord,modules:bundle.modules.map(manifest=>publicRecord(records.get(manifest.id))),event};
  } catch(error){await restoreInstallationSnapshot(snapshot.id);await diag('error','Module bundle installation reverted',{id:bundle.id,error:String(error?.message||error),snapshotId:snapshot.id});throw error;}
}

async function uninstallBundle(id) {
  id=String(id||'').trim().toLowerCase();const bundles=await getInstalledBundles();const bundle=bundles.find(item=>String(item?.id||'').toLowerCase()===id);if(!bundle)return false;
  const snapshot=await snapshotInstallationState('bundle-uninstall',{bundleId:id,version:bundle.version||null});const moduleIds=new Set((bundle.moduleIds||[]).map(moduleId=>String(moduleId).toLowerCase()));const installed=await getInstalledDeclarative();const nextInstalled=installed.filter(item=>!moduleIds.has(String(item?.id||'').toLowerCase()));const nextBundles=bundles.filter(item=>String(item?.id||'').toLowerCase()!==id);await chrome.storage.local.set({[INSTALLED_KEY]:safe(nextInstalled),[BUNDLES_KEY]:safe(nextBundles)});for(const moduleId of moduleIds){clearModuleRegistrations(moduleId);records.delete(moduleId);}await refreshDependencyState();await recordInstallEvent({action:'uninstall',bundleId:id,version:bundle.version||null,snapshotId:snapshot.id,moduleIds:[...moduleIds]});await diag('info','Module bundle uninstalled',{id,moduleIds:[...moduleIds],snapshotId:snapshot.id});return true;
}

async function installPackage(raw) {
  const verification=await verifyPackageEnvelope(raw);
  if(verification.package_type==='module'){
    const module=await installManifest(verification.payload,{packageVerification:verification});
    return {package:{verified:true,publisher_id:verification.publisher_id,key_id:verification.key_id,digest:verification.digest,type:'module'},module};
  }
  if(verification.package_type==='bundle'){
    const result=await installBundle(verification.payload,{packageVerification:verification});
    return {package:{verified:true,publisher_id:verification.publisher_id,key_id:verification.key_id,digest:verification.digest,type:'bundle'},...result};
  }
  throw new Error(`Unsupported package type: ${verification.package_type}`);
}

async function rollbackModule(id, version) {
  id=String(id||'').trim().toLowerCase();
  const current=getRecord(id,{enabled:false});
  if(current.source==='packaged') throw new Error('Packaged modules are extension-versioned and cannot be rolled back independently');
  const snapshot=await lifecycleHistory.findModule(id,version);
  if(!snapshot) throw new Error(`Module history version not found: ${id}@${version}`);
  await installManifest(snapshot.manifest,{recordHistory:true});
  await persistState(id,Boolean(snapshot.enabled));
  const record=getRecord(id,{enabled:false});record.enabled=Boolean(snapshot.enabled);await refreshDependencyState();
  await diag('info','Module rollback completed',{id,from:current.manifest.version,to:version});
  return publicRecord(record);
}

async function rollbackBundle(id, version) {
  id=String(id||'').trim().toLowerCase();
  const snapshot=await lifecycleHistory.findBundle(id,version);
  if(!snapshot?.bundle) throw new Error(`Bundle history version not found: ${id}@${version}`);
  const result=await installBundle(snapshot.bundle,{recordHistory:true});
  if(snapshot.state==='suspended') await setBundleState(id,'suspended');
  else await setBundleState(id,'enabled');
  await diag('info','Bundle rollback completed',{id,to:version});
  return {bundle:publicBundle((await getInstalledBundles()).find(item=>String(item.id).toLowerCase()===id)),modules:result.modules};
}

async function setBundleState(id,state) {
  id=String(id||'').trim().toLowerCase();state=String(state||'').trim().toLowerCase();
  if(!['enabled','suspended'].includes(state)) throw new Error('Bundle state must be enabled or suspended');
  const bundles=await getInstalledBundles();const index=bundles.findIndex(item=>String(item?.id||'').toLowerCase()===id);
  if(index<0) throw new Error(`Unknown module bundle: ${id}`);
  const previousState=String(bundles[index]?.state||'enabled');
  if(previousState===state)return publicBundle(bundles[index]);
  const snapshot=await snapshotInstallationState(`bundle-${state}`,{bundleId:id,version:bundles[index]?.version||null,previousState,nextState:state});
  try {
    const bundle={...bundles[index],state,updatedAt:new Date().toISOString()};bundles[index]=bundle;await chrome.storage.local.set({[BUNDLES_KEY]:safe(bundles)});
    const enabled=state==='enabled';
    for(const moduleId of bundle.moduleIds||[]){
      const record=records.get(String(moduleId).toLowerCase());if(!record)continue;
      await persistState(record.manifest.id,enabled);record.enabled=enabled;
    }
    await refreshDependencyState();
    await recordInstallEvent({action:state==='enabled'?'bundle-enable':'bundle-suspend',bundleId:id,version:bundle.version||null,previousState,state,snapshotId:snapshot.id,moduleIds:safe(bundle.moduleIds||[]),reversible:true});
    await diag('info','Module bundle state changed',{id,state,previousState,moduleIds:safe(bundle.moduleIds||[]),snapshotId:snapshot.id});
    return publicBundle(bundle);
  } catch(error){
    await restoreInstallationSnapshot(snapshot.id);
    await diag('error','Module bundle state change reverted',{id,state,error:String(error?.message||error),snapshotId:snapshot.id});
    throw error;
  }
}

async function issueGovernanceGrant(raw) {
  const moduleId=String(raw?.module_id||'').trim().toLowerCase();
  const record=getRecord(moduleId,{enabled:false});
  const companyId=assertCompanyAccess(record,raw?.company_id||null);
  if(!companyId) throw new Error('Authority grants require company_id');
  const requested=new Set((record.manifest.authority?.requests||[]).map(item=>item.id));
  const authorityIds=Array.isArray(raw?.authority_ids)?raw.authority_ids.map(v=>String(v||'').trim().toLowerCase()).filter(Boolean):[];
  const undeclared=authorityIds.filter(id=>!requested.has(id));
  if(undeclared.length) throw new Error(`Authority grant requests undeclared module authority: ${undeclared.join(', ')}`);
  const actions=Array.isArray(raw?.actions)&&raw.actions.length?raw.actions:['*'];
  if(!actions.includes('*')){
    const allowed=new Set([...(record.manifest.contributes?.commands||[]),...(record.manifest.contributes?.tools||[])].map(item=>item.id));
    const invalid=actions.filter(action=>!allowed.has(String(action).toLowerCase()));if(invalid.length)throw new Error(`Authority grant action is not declared by module: ${invalid.join(', ')}`);
  }
  const grant=await governanceGrants.issue({...safe(raw),company_id:companyId,module_id:record.manifest.id,authority_ids:authorityIds,actions});
  await diag('info','Governance authority grant issued',{id:grant.id,company_id:grant.company_id,module_id:grant.module_id,authority_ids:grant.authority_ids,actions:grant.actions,expires_at:grant.expires_at,issued_by:grant.issued_by});
  return grant;
}

async function resolveGovernedExecution(record,declaration,action,company_id,context={}) {
  if(!declaration?.mutates) return {company_id,module_id:record.manifest.id,action,grant_ids:[],authority_grants:[]};
  const internal=context?.[RESOLVED_AUTHORITY];
  if(internal?.module_id===record.manifest.id && internal?.company_id===company_id){
    assertExecutionAuthority(declaration,{authority_grants:internal.authority_grants});return internal;
  }
  const grantIds=context?.governance_grant_ids||context?.grant_ids||[];
  if(!Array.isArray(grantIds)||!grantIds.length) throw new Error('Mutating execution requires governance grant id(s); direct authority_grants are not accepted as execution authority');
  const resolved=await governanceGrants.resolve({company_id,module_id:record.manifest.id,action,grant_ids:grantIds});
  assertExecutionAuthority(declaration,{authority_grants:resolved.authority_grants});
  return resolved;
}

async function uninstall(id) {
  id=String(id||'').toLowerCase();const record=records.get(id);if(!record)return false;if(record.source==='packaged')throw new Error('Packaged modules cannot be uninstalled at runtime; disable them instead');for(const bundle of await getInstalledBundles())if((bundle.moduleIds||[]).some(moduleId=>String(moduleId).toLowerCase()===id))throw new Error(`Module ${id} belongs to bundle ${bundle.id}; uninstall the bundle instead`);
  const snapshot=await snapshotInstallationState('module-uninstall',{moduleId:id,version:record.manifest.version});const installed=await getInstalledDeclarative();await saveInstalledDeclarative(installed.filter(item=>String(item?.id||'').toLowerCase()!==id));clearModuleRegistrations(id);records.delete(id);await refreshDependencyState();await recordInstallEvent({action:'uninstall',moduleId:id,version:record.manifest.version,snapshotId:snapshot.id});await diag('info','Declarative module uninstalled',{id,snapshotId:snapshot.id});return true;
}

async function recoverModule(id) {
  const record=getRecord(id,{enabled:false});record.runtimeState=clearRuntimeFailures(ensureRuntimeState(record));record.error=null;if(!record.enabled)record.status='disabled';else if(record.source==='installed')record.status='active';else record.status='loaded';await refreshDependencyState();await recordInstallEvent({action:'recover',moduleId:record.manifest.id,version:record.manifest.version,reversible:false});await diag('info','Module runtime recovered',{id:record.manifest.id,status:record.status,runtimeVersion:MODULE_RUNTIME_VERSION});return record;
}

async function setCompanyEnabledLifecycle(id,company_id,enabled){
  const record=getRecord(id,{enabled:false});
  const before=await companyModuleManager.getState(record.manifest.id,company_id);
  const hadOverride=typeof before.enabled==='boolean';
  const previousEnabled=hadOverride?Boolean(before.enabled):null;
  await companyModuleManager.setEnabled(record.manifest.id,company_id,enabled);
  const company=String(company_id||'').trim();
  const event=await recordInstallEvent({action:Boolean(enabled)?'company-enable':'company-disable',moduleId:record.manifest.id,version:record.manifest.version,company_id:company,previous_mode:hadOverride?'explicit':'inherit',previous_enabled:previousEnabled,next_enabled:Boolean(enabled),reversible:true});
  await diag('info','Company module activation changed',{id:record.manifest.id,company_id:company,enabled:Boolean(enabled),previous_mode:event.previous_mode,previous_enabled:previousEnabled,eventId:event.id});
  return {module:await publicCompanyRecord(record,company),event};
}

async function updateCompanyConfigLifecycle(id,company_id,values){
  const record=getRecord(id,{enabled:false});
  const company=String(company_id||'').trim();
  const config=await companyModuleManager.updateConfig(record.manifest.id,company,values||{});
  const keys=Object.keys(values&&typeof values==='object'&&!Array.isArray(values)?values:{}).sort();
  const event=await recordInstallEvent({action:'company-config-update',moduleId:record.manifest.id,version:record.manifest.version,company_id:company,config_keys_changed:keys,reversible:false});
  await diag('info','Company module config updated',{id:record.manifest.id,company_id:company,config_keys_changed:keys,eventId:event.id});
  return {company_id:company,id:record.manifest.id,config,event};
}

async function rollbackCompanyActivation(eventId){
  const history=await getInstallHistory();
  const source=history.find(item=>String(item.id||'')===String(eventId||''));
  if(!source||!['company-enable','company-disable'].includes(source.action)||!source.company_id||!source.moduleId)throw new Error(`Company activation lifecycle event not found or not reversible: ${eventId}`);
  const record=getRecord(source.moduleId,{enabled:false});
  if(source.previous_mode==='inherit')await companyModuleManager.clearEnabledOverride(record.manifest.id,source.company_id);
  else await companyModuleManager.setEnabled(record.manifest.id,source.company_id,Boolean(source.previous_enabled));
  const event=await recordInstallEvent({action:'company-rollback',moduleId:record.manifest.id,version:record.manifest.version,company_id:source.company_id,rollbackOf:source.id,reversible:false});
  await diag('info','Company module activation rolled back',{id:record.manifest.id,company_id:source.company_id,rollbackOf:source.id,eventId:event.id});
  return {module:await publicCompanyRecord(record,source.company_id),event};
}

async function setEnabled(id, enabled) {
  const record=getRecord(id,{enabled:false}),next=Boolean(enabled);if(record.enabled===next)return record;if(next&&record.status==='quarantined')throw new Error(`Module is quarantined after repeated runtime failures: ${id}: ${record.runtimeState?.last_error||record.error||'unknown error'}`);
  const snapshot=await snapshotInstallationState(next?'module-enable':'module-disable',{moduleId:record.manifest.id,version:record.manifest.version});await persistState(record.manifest.id,next);record.enabled=next;await refreshDependencyState();await recordInstallEvent({action:next?'enable':'disable',moduleId:record.manifest.id,version:record.manifest.version,snapshotId:snapshot.id});await diag('info','Module state changed',{id:record.manifest.id,enabled:next,status:record.status,dependencyErrors:record.dependencyErrors,snapshotId:snapshot.id});return record;
}

async function invokeCommand(moduleId, command, payload, company_id=null, context={}) {
  const record = getRecord(moduleId);
  const resolvedCompany = await assertCompanyEnabled(record, company_id);
  const declared = (record.manifest.contributes?.commands || []).find(item => item.id === command);
  if (!declared) throw new Error(`Module command not found: ${record.manifest.id}:${command}`);
  const governed=await resolveGovernedExecution(record,declared,command,resolvedCompany,context);
  const executionContext={company_id:resolvedCompany,command:safe(declared),authority_grants:safe(governed.authority_grants||[]),governance_grant_ids:safe(governed.grant_ids||[])};
  const handler = commandHandlers.get(keyFor(record.manifest.id, command));
  if (handler) return safe(await guardRuntimeExecution(record, `command:${command}`, () => handler(safe(payload), executionContext)));
  if (record.manifest.kind === 'declarative') {
    return {ok:true, declarative:true, module:record.manifest.id, command:declared, payload:safe(payload), company_id:resolvedCompany,governance_grant_ids:safe(governed.grant_ids||[])};
  }
  throw new Error(`Module command has no executable handler: ${record.manifest.id}:${command}`);
}

async function invokeQuery(moduleId, id, payload, company_id=null, context={}) {
  const record=getRecord(moduleId);
  const resolvedCompany=assertCompanyAccess(record,company_id);
  const declaration=(record.manifest.contributes?.queries||[]).find(item=>item.id===String(id||'').trim());
  if(!declaration) throw new Error(`Unknown module query: ${moduleId}:${id}`);
  const handler=queryHandlers.get(keyFor(record.manifest.id,declaration.id));
  if(typeof handler!=='function') throw new Error(`Module query handler unavailable: ${moduleId}:${id}`);
  return safe(await guardRuntimeExecution(record, `query:${declaration.id}`, () => handler(safe(payload||{}),{...safe(context||{}),company_id:resolvedCompany},safe(declaration))));
}

async function invokeTool(moduleId, id, payload, company_id=null, context={}) {
  const record = getRecord(moduleId);
  const resolvedCompany = await assertCompanyEnabled(record, company_id);
  const tool = (record.manifest.contributes?.tools || []).find(item => item.id === id);
  if (!tool) throw new Error(`Module tool not found: ${record.manifest.id}:${id}`);
  const governed=await resolveGovernedExecution(record,tool,id,resolvedCompany,context);
  const executionContext={company_id:resolvedCompany,tool:safe(tool),authority_grants:safe(governed.authority_grants||[]),governance_grant_ids:safe(governed.grant_ids||[])};
  const handler = toolHandlers.get(keyFor(record.manifest.id,id));
  if (handler) return safe(await guardRuntimeExecution(record, `tool:${id}`, () => handler(safe(payload), executionContext)));
  if (tool.command) return invokeCommand(record.manifest.id, tool.command, payload, resolvedCompany, {...context,[RESOLVED_AUTHORITY]:governed});
  throw new Error(`Module tool has no executable handler: ${record.manifest.id}:${id}`);
}

async function invokeProvider(moduleId, id, payload, company_id=null) {
  const record = getRecord(moduleId);
  const resolvedCompany = await assertCompanyEnabled(record, company_id);
  const provider = (record.manifest.contributes?.providers || []).find(item => item.id === id);
  if (!provider) throw new Error(`Module provider not found: ${record.manifest.id}:${id}`);
  const handler = providerHandlers.get(keyFor(record.manifest.id,id));
  if (!handler) throw new Error(`Provider ${record.manifest.id}:${id} is registered as metadata only; executable providers must be packaged with Titan Zero`);
  return safe(await guardRuntimeExecution(record, `provider:${id}`, () => handler(safe(payload), {company_id:resolvedCompany,provider:safe(provider)})));
}

function getPath(root, path) {
  if (!path) return safe(root);
  let current=root;
  for (const part of String(path).split('.').filter(Boolean)) {
    if (current==null || typeof current!=='object') return undefined;
    current=current[part];
  }
  return safe(current);
}

function settingsStorageKey(moduleId, company_id=null) {
  return `${SETTINGS_PREFIX}:${moduleId}:${company_id || 'global'}`;
}

function settingsFields(record) {
  return (record.manifest.contributes?.settingsPanels || []).flatMap(panel => panel.fields || []);
}

function defaultsFor(record) {
  const out={};
  for (const field of settingsFields(record)) if ('default' in field && !(field.id in out)) out[field.id]=safe(field.default);
  return out;
}

async function getSettingsForRecord(record, company_id=null) {
  const resolvedCompany = await assertCompanyEnabled(record, company_id);
  const key = settingsStorageKey(record.manifest.id,resolvedCompany);
  const data = await chrome.storage.local.get([key]);
  const stored = data[key] && typeof data[key] === 'object' ? data[key] : {};
  return {...defaultsFor(record),...safe(stored)};
}

async function updateSettingsForRecord(record, values, company_id=null) {
  const resolvedCompany = await assertCompanyEnabled(record, company_id);
  const allowed = new Set(settingsFields(record).map(field=>field.id));
  const current = await getSettingsForRecord(record,resolvedCompany);
  const incoming = values && typeof values==='object' ? values : {};
  for (const [key,value] of Object.entries(incoming)) if (allowed.has(key)) current[key]=safe(value);
  const storageKey=settingsStorageKey(record.manifest.id,resolvedCompany);
  await chrome.storage.local.set({[storageKey]:safe(current)});
  await diag('info','Module settings updated',{id:record.manifest.id,company_id:resolvedCompany||null,fields:Object.keys(incoming).filter(key=>allowed.has(key))});
  return safe(current);
}

async function resolveProjection(moduleId, id, company_id=null) {
  const record = getRecord(moduleId);
  const resolvedCompany = await assertCompanyEnabled(record, company_id);
  const projection = (record.manifest.contributes?.projections || []).find(item => item.id === id);
  if (!projection) throw new Error(`Module projection not found: ${record.manifest.id}:${id}`);
  const handler = projectionHandlers.get(keyFor(record.manifest.id,id));
  if (handler) return safe(await guardRuntimeExecution(record, `projection:${id}`, () => handler({company_id:resolvedCompany,projection:safe(projection)})));
  if (projection.source === 'settings') return getPath(await getSettingsForRecord(record,resolvedCompany), projection.key);
  if (projection.source === 'storage') {
    if (!projection.key) return null;
    const storageKey=`${DATA_PREFIX}:${record.manifest.id}:${projection.key}`;
    const data=await chrome.storage.local.get([storageKey]);
    return safe(data[storageKey]);
  }
  if (projection.source === 'static') return safe(projection.value);
  throw new Error(`Runtime projection ${record.manifest.id}:${id} requires a packaged projection handler`);
}

async function runWorkflow(moduleId, id, input={}, company_id=null, context={}) {
  const record = getRecord(moduleId);
  const resolvedCompany = await assertCompanyEnabled(record, company_id);
  const workflow = (record.manifest.contributes?.workflows || []).find(item=>item.id===id);
  if (!workflow) throw new Error(`Module workflow not found: ${record.manifest.id}:${id}`);
  try {
    return await executeWorkflow({
      moduleId:record.manifest.id,
      workflow:safe(workflow),
      input:safe(input),
      context:{company_id:resolvedCompany,governance_grant_ids:safe(context?.governance_grant_ids||context?.grant_ids||[])},
      invokeTool:({moduleId:target,id:toolId,payload,company_id:cid})=>invokeTool(target,toolId,payload,cid,context),
      invokeCommand:({moduleId:target,id:commandId,payload,company_id:cid})=>invokeCommand(target,commandId,payload,cid,context),
      resolveProjection:({moduleId:target,id:projectionId,company_id:cid})=>resolveProjection(target,projectionId,cid),
    });
  } catch (error) {
    markRuntimeFailure(record,error);
    await diag('error','Module workflow failed',{moduleId:record.manifest.id,workflow:id,error:String(error?.message||error),runtimeState:safe(record.runtimeState)});
    throw error;
  }
}

async function runWorker(moduleId, id, input={}, company_id=null, context={}) {
  const record = getRecord(moduleId);
  const resolvedCompany = await assertCompanyEnabled(record, company_id);
  const worker = (record.manifest.contributes?.workers || []).find(item=>item.id===id);
  if (!worker) throw new Error(`Module worker not found: ${record.manifest.id}:${id}`);
  const task={moduleId:record.manifest.id,workerId:worker.id,name:worker.name,role:worker.role,instructions:worker.instructions,tools:safe(worker.tools),channels:safe(worker.channels),autonomy:worker.autonomy,input:safe(input),company_id:resolvedCompany};
  if (!worker.workflow) return {ok:true,executed:false,task};
  const workflowResult=await runWorkflow(record.manifest.id,worker.workflow,input,resolvedCompany,context);
  return {ok:true,executed:true,task,workflow:worker.workflow,result:workflowResult};
}

async function publishModuleEvent(moduleId, type, payload={}, company_id=null, context={}, depth=0) {
  if (depth > MAX_EVENT_DEPTH) throw new Error(`Module event depth exceeded ${MAX_EVENT_DEPTH}`);
  const publisher = getRecord(moduleId);
  const resolvedCompany = await assertCompanyEnabled(publisher, company_id);
  if (!resolvedCompany) throw new Error('Module events require company_id');
  const event = await moduleEventBus.publish({module_id:publisher.manifest.id,type,payload:safe(payload),company_id:resolvedCompany});
  const deliveries=[];
  for (const record of records.values()) {
    if (!record.enabled || record.status !== 'active' || !moduleAppliesToCompany(record.manifest,resolvedCompany) || !(await companyModuleManager.isEnabled(record,resolvedCompany))) continue;
    for (const subscription of record.manifest.contributes?.events || []) {
      if (subscription.type !== event.type) continue;
      try {
        let result;
        if (subscription.workflow) result=await runWorkflow(record.manifest.id,subscription.workflow,{event:safe(event)},resolvedCompany,context);
        else result=await invokeCommand(record.manifest.id,subscription.command,{event:safe(event)},resolvedCompany,context);
        deliveries.push({moduleId:record.manifest.id,subscription:subscription.id,ok:true,result:safe(result)});
      } catch (error) {
        deliveries.push({moduleId:record.manifest.id,subscription:subscription.id,ok:false,error:String(error?.message||error)});
        await diag('warn','Module event subscription failed',{publisher:publisher.manifest.id,moduleId:record.manifest.id,subscription:subscription.id,type:event.type,error:String(error?.message||error)});
      }
    }
    const handler=eventHandlers.get(keyFor(record.manifest.id,event.type));
    if (handler) {
      try {
        const result=await guardRuntimeExecution(record, `event:${event.type}`, () => handler(safe(event),{company_id:resolvedCompany,governance_grant_ids:safe(context?.governance_grant_ids||context?.grant_ids||[]),publish:(nextType,nextPayload)=>publishModuleEvent(record.manifest.id,nextType,nextPayload,resolvedCompany,context,depth+1)}));
        deliveries.push({moduleId:record.manifest.id,subscription:`handler:${event.type}`,ok:true,result:safe(result)});
      } catch (error) {
        deliveries.push({moduleId:record.manifest.id,subscription:`handler:${event.type}`,ok:false,error:String(error?.message||error)});
        await diag('warn','Packaged module event handler failed',{moduleId:record.manifest.id,type:event.type,error:String(error?.message||error)});
      }
    }
  }
  await diag('info','Module event published',{moduleId:publisher.manifest.id,type:event.type,company_id:resolvedCompany,deliveries:deliveries.length});
  return {event,deliveries};
}


let capabilityStaticSourcesPromise;
async function loadCapabilityStaticSources() {
  if (!capabilityStaticSourcesPromise) capabilityStaticSourcesPromise = (async () => {
    let services=[];
    let certifiedWorkflows=[];
    let nativeWorkers=[];
    let nativeEntries=[];
    try {
      const response=await fetch(chrome.runtime.getURL('titan-business-services/canonical-service-owners.json'));
      if (response.ok) services=(await response.json())?.services||[];
    } catch (error) { await diag('warn','Capability service source unavailable',{error:String(error?.message||error)}); }
    try {
      const response=await fetch(chrome.runtime.getURL('titan-business-services/workflows/index.json'));
      if (response.ok) {
        const payload=await response.json();
        certifiedWorkflows=payload?.workflows||payload?.items||[];
      }
    } catch (error) { await diag('warn','Capability workflow source unavailable',{error:String(error?.message||error)}); }
    try {
      const response=await fetch(chrome.runtime.getURL('titan-workforce/catalogue/installed-client-workforce-master.json'));
      if (response.ok) nativeWorkers=(await response.json())?.roles||[];
    } catch (error) { await diag('warn','Capability workforce source unavailable',{error:String(error?.message||error)}); }
    try {
      const response=await fetch(chrome.runtime.getURL('titan-capabilities/native-contributions.json'));
      if (response.ok) nativeEntries=(await response.json())?.entries||[];
    } catch (error) { await diag('warn','Native capability contribution source unavailable',{error:String(error?.message||error)}); }
    return {services:safe(services),certifiedWorkflows:safe(certifiedWorkflows),nativeWorkers:safe(nativeWorkers),nativeEntries:safe(nativeEntries)};
  })();
  return capabilityStaticSourcesPromise;
}

async function getCapabilityRegistrySnapshot(company_id=null) {
  const sources=await loadCapabilityStaticSources();
  const sourceRecords=company_id ? await companyModuleManager.overlay([...records.values()],company_id) : [...records.values()];
  const dependency=company_id ? await companyModuleManager.resolve([...records.values()],company_id) : dependencyState;
  const effective=sourceRecords.map(record=>({...record,status:dependency.blocked?.[record.manifest.id]?'blocked':record.status}));
  return buildCapabilityRegistry(effective,{company_id,services:sources.services,certifiedWorkflows:sources.certifiedWorkflows,nativeWorkers:sources.nativeWorkers,nativeEntries:sources.nativeEntries});
}

async function getDiagnostics() {
  const moduleChecks = [];
  const installedBundles=(await getInstalledBundles()).map(publicBundle);
  const grants=await governanceGrants.list({include_inactive:true});
  let marketplace={items:0,error:null};
  try{const catalog=await marketplaceRuntime.list();marketplace={items:(catalog.items||[]).length,error:null};}catch(error){marketplace={items:0,error:String(error?.message||error)};}
  for (const [key, fn] of diagnostics) {
    const [moduleId, ...rest] = key.split(':');
    const record = records.get(moduleId);
    if (!record?.enabled) continue;
    try { moduleChecks.push({moduleId, name:rest.join(':'), ok:true, result:safe(await fn())}); }
    catch (error) { moduleChecks.push({moduleId, name:rest.join(':'), ok:false, error:String(error?.message || error)}); }
  }
  const contributionTotals=Object.fromEntries(CONTRIBUTION_TYPES.map(type=>[type,[...records.values()].filter(r=>r.enabled).reduce((n,r)=>n+(r.manifest.contributes?.[type]?.length||0),0)]));
  const capabilityRegistry=await getCapabilityRegistrySnapshot(null);
  return {
    ok:[...records.values()].every(r => !['error','quarantined'].includes(r.status)),
    total:records.size,
    enabled:[...records.values()].filter(r => r.enabled).length,
    error:[...records.values()].filter(r => r.status === 'error').length,
    blocked:[...records.values()].filter(r => r.status === 'blocked').length,
    quarantined:[...records.values()].filter(r => r.status === 'quarantined').length,
    runtimeVersion:MODULE_RUNTIME_VERSION,
    intentCapabilityRouterVersion:INTENT_CAPABILITY_ROUTER_VERSION,
    dependencyState:safe(dependencyState),
    contributions:contributionTotals,
    capabilityRegistry:{version:capabilityRegistry.version,totals:safe(capabilityRegistry.totals)},
    handlers:{commands:commandHandlers.size,queries:queryHandlers.size,tools:toolHandlers.size,providers:providerHandlers.size,projections:projectionHandlers.size,events:eventHandlers.size,diagnostics:diagnostics.size},
    modules:[...records.values()].map(publicRecord),
    bundles:installedBundles,
    governance:{total:grants.length,active:grants.filter(item=>item.active).length},
    marketplace,
    checks:moduleChecks,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'TITAN_MODULES') return;
  (async () => {
    await ready;
    assertLifecycleActionSender(message.action,sender,{extensionBase:chrome.runtime.getURL?.('')||''});
    switch (message.action) {
      case 'list': return {ok:true, modules:[...records.values()].map(publicRecord)};
      case 'listForCompany': { const company_id=String(message.company_id||'').trim(); const modules=[]; for(const record of records.values()) if(moduleAppliesToCompany(record.manifest,company_id)) modules.push(await publicCompanyRecord(record,company_id)); return {ok:true,company_id,modules}; }
      case 'get': return {ok:true,module:publicRecord(getRecord(message.id,{enabled:false}))};
      case 'validateInstall': return {ok:true,validation:await validateManifestInstall(message.manifest)};
      case 'validateBundleInstall': return {ok:true,validation:await validateBundleInstall(message.bundle)};
      case 'installManifest': return {ok:true, module:await installManifest(message.manifest)};
      case 'installPackage': return {ok:true,...await installPackage(message.package)};
      case 'installBundle': { const result=await installBundle(message.bundle); return {ok:true,...result}; }
      case 'listBundles': return {ok:true,bundles:(await getInstalledBundles()).map(publicBundle)};
      case 'setBundleState': return {ok:true,bundle:await setBundleState(message.id,message.state)};
      case 'uninstallBundle': return {ok:true,removed:await uninstallBundle(message.id)};
      case 'installationHistory': { const history=await getInstallHistory(); const moduleId=String(message.moduleId||'').toLowerCase(); const bundleId=String(message.bundleId||'').toLowerCase(); return {ok:true,history:history.filter(item=>(!moduleId||String(item.moduleId||'').toLowerCase()===moduleId)&&(!bundleId||String(item.bundleId||'').toLowerCase()===bundleId)).slice().reverse()}; }
      case 'rollbackInstall': return {ok:true,...await restoreInstallationSnapshot(message.snapshotId)};
      case 'listHistory': return {ok:true,history:message.kind==='bundle'?await lifecycleHistory.listBundle(message.id):await lifecycleHistory.listModule(message.id)};
      case 'rollbackModule': return {ok:true,module:await rollbackModule(message.id,message.version)};
      case 'rollbackBundle': return {ok:true,...await rollbackBundle(message.id,message.version)};
      case 'issueGrant': return {ok:true,grant:await issueGovernanceGrant(message.grant||{})};
      case 'revokeGrant': return {ok:true,grant:await governanceGrants.revoke(message.id,{revoked_by:message.revoked_by||'user:module-manager',reason:message.reason||''})};
      case 'listGrants': return {ok:true,grants:await governanceGrants.list({company_id:message.company_id||null,module_id:message.module_id||null,include_inactive:message.include_inactive!==false})};
      case 'listMarketplace': return {ok:true,catalog:await marketplaceRuntime.list()};
      case 'installMarketplace': return {ok:true,...await marketplaceRuntime.install(message.id)};
      case 'uninstall': return {ok:true, removed:await uninstall(message.id)};
      case 'setEnabled': return {ok:true,module:publicRecord(await setEnabled(message.id,message.enabled))};
      case 'setCompanyEnabled': { const result=await setCompanyEnabledLifecycle(message.id,message.company_id,message.enabled); return {ok:true,...result}; }
      case 'rollbackCompanyActivation': return {ok:true,...await rollbackCompanyActivation(message.eventId)};
      case 'getCompanyConfig': { const record=getRecord(message.id,{enabled:false}); const company_id=String(message.company_id||'').trim(); return {ok:true,company_id,id:record.manifest.id,config:await companyModuleManager.getConfig(record.manifest.id,company_id)}; }
      case 'updateCompanyConfig': return {ok:true,...await updateCompanyConfigLifecycle(message.id,message.company_id,message.values||{})};
      case 'discoverCapabilities': return {ok:true,company_id:String(message.company_id||'').trim(),items:await companyModuleManager.discoverCapabilities([...records.values()],message.company_id)};
      case 'resolveCompanyDependencies': return {ok:true,...await companyModuleManager.resolve([...records.values()],message.company_id)};
      case 'recoverModule': return {ok:true,module:publicRecord(await recoverModule(message.id))};
      case 'invoke': return {ok:true, result:await invokeCommand(message.id, message.command, message.payload, message.company_id || null, message.context || {})};
      case 'invokeQuery': return {ok:true,result:await invokeQuery(message.moduleId,message.id,message.payload,message.company_id||null,message.context||{})};
      case 'resolveIntent': {
        const company_id=message.company_id||null;
        const sourceRecords=company_id?await companyModuleManager.overlay([...records.values()],company_id):[...records.values()];
        const dependency=company_id?await companyModuleManager.resolve([...records.values()],company_id):dependencyState;
        const effective=sourceRecords.map(record=>({...record,status:dependency.blocked?.[record.manifest.id]?'blocked':record.status}));
        const match=resolveModuleIntent(effective,message.text,company_id);
        return {ok:true,match,text:match?applyIntentTransform(message.text,match):String(message.text||'')};
      }
      case 'listContributions': { const company_id=message.company_id||null; const sourceRecords=company_id?await companyModuleManager.overlay([...records.values()],company_id):[...records.values()]; const dependency=company_id?await companyModuleManager.resolve([...records.values()],company_id):dependencyState; return {ok:true,items:listModuleContributions(sourceRecords.map(record=>({...record,status:dependency.blocked?.[record.manifest.id]?'blocked':record.status})),message.contributionType,company_id)}; }
      case 'getContribution': { const company_id=message.company_id||null; const sourceRecords=company_id?await companyModuleManager.overlay([...records.values()],company_id):[...records.values()]; const dependency=company_id?await companyModuleManager.resolve([...records.values()],company_id):dependencyState; return {ok:true,item:getModuleContribution(sourceRecords.map(record=>({...record,status:dependency.blocked?.[record.manifest.id]?'blocked':record.status})),message.contributionType,message.id,company_id,message.moduleId||null)}; }
      case 'invokeTool': return {ok:true,result:await invokeTool(message.moduleId,message.id,message.payload,message.company_id||null,message.context||{})};
      case 'invokeProvider': return {ok:true,result:await invokeProvider(message.moduleId,message.id,message.payload,message.company_id||null)};
      case 'resolveProjection': return {ok:true,result:await resolveProjection(message.moduleId,message.id,message.company_id||null)};
      case 'runWorkflow': return {ok:true,result:await runWorkflow(message.moduleId,message.id,message.input,message.company_id||null,message.context||{})};
      case 'runWorker': return {ok:true,result:await runWorker(message.moduleId,message.id,message.input,message.company_id||null,message.context||{})};
      case 'getSettings': {
        const record=getRecord(message.moduleId);
        return {ok:true,settings:await getSettingsForRecord(record,message.company_id||null)};
      }
      case 'updateSettings': {
        const record=getRecord(message.moduleId);
        return {ok:true,settings:await updateSettingsForRecord(record,message.values,message.company_id||null)};
      }
      case 'resolveDependencies': return safe(dependencyState);
      case 'publishEvent': return {ok:true,...await publishModuleEvent(message.moduleId,message.eventType,message.payload,message.company_id||null,message.context||{})};
      case 'getEventLog': return {ok:true,events:await moduleEventBus.list({company_id:message.company_id,limit:message.limit})};
      case 'clearEventLog': return {ok:true,cleared:await moduleEventBus.clear({company_id:message.company_id})};
      case 'getCapabilityRegistry': return {ok:true,registry:await getCapabilityRegistrySnapshot(message.company_id||null)};
      case 'findCapabilities': { const registry=await getCapabilityRegistrySnapshot(message.company_id||null); return {ok:true,items:findCapabilities(registry,message.query||'',message.filters||{})}; }
      case 'getCapabilityEntry': { const registry=await getCapabilityRegistrySnapshot(message.company_id||null); return {ok:true,item:getCapability(registry,message.registryId||message.id)}; }
      case 'routeIntentToCapabilities': { const registry=await getCapabilityRegistrySnapshot(message.company_id||null); return {ok:true,route:routeIntentToCapabilities(registry,{text:message.text||'',company_id:message.company_id||null,preferred_kinds:message.preferred_kinds||message.preferredKinds||[],risk_ceiling:message.risk_ceiling||message.riskCeiling||null,limit:message.limit,min_confidence:message.min_confidence||message.minConfidence,context:message.context||null,workflow_goal:message.workflow_goal||message.workflowGoal||null,agent_goal:message.agent_goal||message.agentGoal||null})}; }
      case 'getDiagnostics': return await getDiagnostics();
      default: throw new Error(`Unknown TITAN_MODULES action: ${message.action}`);
    }
  })().then(sendResponse).catch(async error => {
    await diag('error', 'Module request failed', {action:message.action, error:String(error?.message || error)});
    sendResponse({ok:false, error:String(error?.message || error)});
  });
  return true;
});

initialize();
