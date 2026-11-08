// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/module-registry.mjs
import {normalizeAuthority, normalizeAuthorityIds} from './authority.js';
import {normalizeRuntimePolicy} from './runtime-policy.js';
const ID_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const FORBIDDEN_SCOPE_KEYS = new Set(['tenant_id', 'tenant_company_id']);
const EXECUTABLE_KEYS = new Set(['script', 'scripturl', 'javascript', 'code', 'handler', 'execute', 'entry']);
const BLOCK_TYPES = new Set(['text', 'metric', 'list', 'actions', 'projection', 'settings', 'workers', 'workflows']);
const WORKFLOW_STEP_TYPES = new Set(['tool', 'command', 'projection', 'set']);
const SETTING_FIELD_TYPES = new Set(['text', 'textarea', 'number', 'boolean', 'select', 'secret']);
const PROJECTION_SOURCES = new Set(['settings', 'storage', 'static', 'runtime']);

export const MODULE_KINDS = Object.freeze(['packaged', 'declarative']);
export const CONTRIBUTION_TYPES = Object.freeze([
  'capabilities', 'intents', 'commands', 'queries', 'links', 'feed', 'settings',
  'screens', 'workers', 'tools', 'providers', 'projections', 'workflows', 'settingsPanels', 'events', 'verticals',
]);

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function assertNoLegacyTenantKeys(value, path='module') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoLegacyTenantKeys(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SCOPE_KEYS.has(key)) throw new Error(`${path}.${key} is not allowed; use company_id as the only company boundary`);
    assertNoLegacyTenantKeys(child, `${path}.${key}`);
  }
}

function assertNoExecutableFields(value, path='module.contributes') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoExecutableFields(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (EXECUTABLE_KEYS.has(String(key).toLowerCase())) {
      throw new Error(`${path}.${key} is an executable field and is not allowed in declarative modules`);
    }
    assertNoExecutableFields(child, `${path}.${key}`);
  }
}

function stringArray(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw new Error(`${field} must be an array of strings`);
  return [...new Set(value.map(v => v.trim()).filter(Boolean))];
}

function requiredId(value, field) {
  const id = String(value || '').trim();
  if (!ID_RE.test(id.toLowerCase())) throw new Error(`${field} must use letters, numbers, dot, underscore or hyphen`);
  return id;
}

function normalizeIntent(intent, index) {
  if (!intent || typeof intent !== 'object') throw new Error(`contributes.intents[${index}] must be an object`);
  const id = String(intent.id || '').trim();
  if (!id) throw new Error(`contributes.intents[${index}].id is required`);
  const patterns = stringArray(intent.patterns, `contributes.intents[${index}].patterns`);
  if (!patterns.length) throw new Error(`contributes.intents[${index}].patterns must not be empty`);
  const route = intent.route === 'chat' ? 'chat' : 'work';
  return {
    id,
    patterns,
    route,
    prepend: typeof intent.prepend === 'string' ? intent.prepend.trim() : '',
    append: typeof intent.append === 'string' ? intent.append.trim() : '',
    priority: Number.isFinite(Number(intent.priority)) ? Number(intent.priority) : 0,
  };
}

function normalizeQuery(query, index) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new Error(`contributes.queries[${index}] must be an object`);
  const id = requiredId(query.id, `contributes.queries[${index}].id`);
  return {id, title:String(query.title || id).trim(), description:String(query.description || '').trim()};
}

function normalizeCommand(command, index) {
  if (!command || typeof command !== 'object') throw new Error(`contributes.commands[${index}] must be an object`);
  const id = requiredId(command.id, `contributes.commands[${index}].id`);
  const title = String(command.title || id).trim();
  const mutates = Boolean(command.mutates);
  const authority = normalizeAuthorityIds(command.authority || [], `contributes.commands[${index}].authority`);
  if (mutates && !authority.length) throw new Error(`contributes.commands[${index}] mutates state and must declare authority`);
  return {id, title, description: String(command.description || '').trim(), mutates, authority};
}

function normalizeScreenBlock(block, screenIndex, blockIndex) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) throw new Error(`contributes.screens[${screenIndex}].blocks[${blockIndex}] must be an object`);
  const type = String(block.type || '').trim();
  if (!BLOCK_TYPES.has(type)) throw new Error(`Unsupported screen block type: ${type || '(empty)'}`);
  const out = clone(block);
  out.type = type;
  if (type === 'projection') out.projection = requiredId(block.projection, `contributes.screens[${screenIndex}].blocks[${blockIndex}].projection`);
  if (type === 'settings') out.panel = requiredId(block.panel, `contributes.screens[${screenIndex}].blocks[${blockIndex}].panel`);
  return out;
}

function normalizeScreen(screen, index) {
  if (!screen || typeof screen !== 'object' || Array.isArray(screen)) throw new Error(`contributes.screens[${index}] must be an object`);
  const id = requiredId(screen.id, `contributes.screens[${index}].id`);
  const blocks = Array.isArray(screen.blocks) ? screen.blocks.map((block, blockIndex) => normalizeScreenBlock(block, index, blockIndex)) : [];
  return {id, title:String(screen.title || id).trim(), description:String(screen.description || '').trim(), icon:String(screen.icon || '').trim(), blocks};
}

function normalizeWorker(worker, index) {
  if (!worker || typeof worker !== 'object' || Array.isArray(worker)) throw new Error(`contributes.workers[${index}] must be an object`);
  const id = requiredId(worker.id, `contributes.workers[${index}].id`);
  return {
    id,
    name:String(worker.name || id).trim(),
    role:String(worker.role || '').trim(),
    description:String(worker.description || '').trim(),
    instructions:String(worker.instructions || '').trim(),
    tools:stringArray(worker.tools, `contributes.workers[${index}].tools`),
    workflow:worker.workflow == null || worker.workflow === '' ? null : requiredId(worker.workflow, `contributes.workers[${index}].workflow`),
    channels:stringArray(worker.channels, `contributes.workers[${index}].channels`),
    autonomy:String(worker.autonomy || 'suggest').trim().toLowerCase(),
    vertical:String(worker.vertical || '').trim().toLowerCase(),
    department:String(worker.department || '').trim(),
    capabilities:stringArray(worker.capabilities, `contributes.workers[${index}].capabilities`),
    riskCeiling:String(worker.riskCeiling || worker.risk_ceiling || 'LOW').trim().toUpperCase(),
    evidenceRequired:stringArray(worker.evidenceRequired, `contributes.workers[${index}].evidenceRequired`),
    approvalRequiredFor:stringArray(worker.approvalRequiredFor, `contributes.workers[${index}].approvalRequiredFor`),
  };
}

function normalizeTool(tool, index) {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) throw new Error(`contributes.tools[${index}] must be an object`);
  const id = requiredId(tool.id, `contributes.tools[${index}].id`);
  const out = {
    id,
    title:String(tool.title || id).trim(),
    description:String(tool.description || '').trim(),
    command:tool.command == null || tool.command === '' ? null : requiredId(tool.command, `contributes.tools[${index}].command`),
    permissions:stringArray(tool.permissions, `contributes.tools[${index}].permissions`),
    mutates:Boolean(tool.mutates),
    authority:normalizeAuthorityIds(tool.authority || [], `contributes.tools[${index}].authority`),
    inputSchema:tool.inputSchema && typeof tool.inputSchema === 'object' ? clone(tool.inputSchema) : null,
    outputSchema:tool.outputSchema && typeof tool.outputSchema === 'object' ? clone(tool.outputSchema) : null,
  };
  if (out.mutates && !out.authority.length) throw new Error(`contributes.tools[${index}] mutates state and must declare authority`);
  return out;
}

function normalizeProvider(provider, index) {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) throw new Error(`contributes.providers[${index}] must be an object`);
  const id = requiredId(provider.id, `contributes.providers[${index}].id`);
  return {
    id,
    title:String(provider.title || id).trim(),
    type:String(provider.type || 'custom').trim().toLowerCase(),
    description:String(provider.description || '').trim(),
    capabilities:stringArray(provider.capabilities, `contributes.providers[${index}].capabilities`),
    settingsPanel:provider.settingsPanel == null || provider.settingsPanel === '' ? null : requiredId(provider.settingsPanel, `contributes.providers[${index}].settingsPanel`),
  };
}

function normalizeProjection(projection, index) {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) throw new Error(`contributes.projections[${index}] must be an object`);
  const id = requiredId(projection.id, `contributes.projections[${index}].id`);
  const source = String(projection.source || 'runtime').trim().toLowerCase();
  if (!PROJECTION_SOURCES.has(source)) throw new Error(`contributes.projections[${index}].source must be one of: ${[...PROJECTION_SOURCES].join(', ')}`);
  return {
    id,
    title:String(projection.title || id).trim(),
    description:String(projection.description || '').trim(),
    source,
    key:projection.key == null ? null : String(projection.key).trim(),
    value:source === 'static' ? clone(projection.value) : undefined,
  };
}

function normalizeWorkflowStep(step, workflowIndex, stepIndex) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`contributes.workflows[${workflowIndex}].steps[${stepIndex}] must be an object`);
  const type = String(step.type || '').trim().toLowerCase();
  if (!WORKFLOW_STEP_TYPES.has(type)) throw new Error(`Unsupported workflow step type: ${type || '(empty)'}`);
  const out = {type};
  if (step.module_id != null && step.module_id !== '') out.module_id = requiredId(step.module_id, `contributes.workflows[${workflowIndex}].steps[${stepIndex}].module_id`);
  if (step.assign != null && step.assign !== '') out.assign = String(step.assign).trim();
  if (type === 'tool') out.tool = requiredId(step.tool, `contributes.workflows[${workflowIndex}].steps[${stepIndex}].tool`);
  if (type === 'command') out.command = requiredId(step.command, `contributes.workflows[${workflowIndex}].steps[${stepIndex}].command`);
  if (type === 'projection') out.projection = requiredId(step.projection, `contributes.workflows[${workflowIndex}].steps[${stepIndex}].projection`);
  if (type === 'set') out.key = String(step.key || '').trim();
  if (type === 'set' && !out.key) throw new Error(`contributes.workflows[${workflowIndex}].steps[${stepIndex}].key is required`);
  if ('input' in step) out.input = clone(step.input);
  if ('value' in step) out.value = clone(step.value);
  return out;
}

function normalizeWorkflow(workflow, index) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) throw new Error(`contributes.workflows[${index}] must be an object`);
  const id = requiredId(workflow.id, `contributes.workflows[${index}].id`);
  const steps = Array.isArray(workflow.steps) ? workflow.steps.map((step, stepIndex) => normalizeWorkflowStep(step, index, stepIndex)) : [];
  if (steps.length > 32) throw new Error(`contributes.workflows[${index}] exceeds maximum 32 steps`);
  return {id, title:String(workflow.title || id).trim(), description:String(workflow.description || '').trim(), steps};
}

function normalizeSettingField(field, panelIndex, fieldIndex) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) throw new Error(`contributes.settingsPanels[${panelIndex}].fields[${fieldIndex}] must be an object`);
  const id = requiredId(field.id, `contributes.settingsPanels[${panelIndex}].fields[${fieldIndex}].id`);
  const type = String(field.type || 'text').trim().toLowerCase();
  if (!SETTING_FIELD_TYPES.has(type)) throw new Error(`Unsupported settings field type: ${type}`);
  const out = {id, label:String(field.label || id).trim(), type, description:String(field.description || '').trim()};
  if ('default' in field) out.default = clone(field.default);
  if (type === 'select') out.options = Array.isArray(field.options) ? clone(field.options) : [];
  if (field.placeholder != null) out.placeholder = String(field.placeholder);
  return out;
}

function normalizeSettingsPanel(panel, index) {
  if (!panel || typeof panel !== 'object' || Array.isArray(panel)) throw new Error(`contributes.settingsPanels[${index}] must be an object`);
  const id = requiredId(panel.id, `contributes.settingsPanels[${index}].id`);
  const fields = Array.isArray(panel.fields) ? panel.fields.map((field, fieldIndex) => normalizeSettingField(field, index, fieldIndex)) : [];
  return {id, title:String(panel.title || id).trim(), description:String(panel.description || '').trim(), fields};
}

function normalizeEventSubscription(event, index) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error(`contributes.events[${index}] must be an object`);
  const id = requiredId(event.id, `contributes.events[${index}].id`);
  const type = String(event.type || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(type)) throw new Error(`contributes.events[${index}].type is invalid`);
  const workflow = event.workflow == null || event.workflow === '' ? null : requiredId(event.workflow, `contributes.events[${index}].workflow`);
  const command = event.command == null || event.command === '' ? null : requiredId(event.command, `contributes.events[${index}].command`);
  if (Number(Boolean(workflow)) + Number(Boolean(command)) !== 1) throw new Error(`contributes.events[${index}] must declare exactly one workflow or command`);
  return {id,type,workflow,command};
}

function normalizeVertical(vertical, index) {
  if (!vertical || typeof vertical !== 'object' || Array.isArray(vertical)) throw new Error(`contributes.verticals[${index}] must be an object`);
  const id = requiredId(vertical.id, `contributes.verticals[${index}].id`);
  const company_boundary=String(vertical.company_boundary || 'company_id').trim();
  if(company_boundary!=='company_id') throw new Error(`contributes.verticals[${index}].company_boundary must be company_id`);
  return {
    id,
    name:String(vertical.name || id).trim(),
    icon:String(vertical.icon || '').trim(),
    keywords:stringArray(vertical.keywords, `contributes.verticals[${index}].keywords`),
    company_boundary,
    source_of_truth:String(vertical.source_of_truth || 'module').trim(),
  };
}

function normalizeList(value, fn) { return Array.isArray(value) ? value.map(fn) : []; }

function normalizeDependency(dep, index) {
  if (!dep || typeof dep !== 'object' || Array.isArray(dep)) throw new Error(`requires.modules[${index}] must be an object`);
  const id = requiredId(dep.id, `requires.modules[${index}].id`).toLowerCase();
  const range = String(dep.range == null ? '*' : dep.range).trim() || '*';
  if (!/^(?:\*|\^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|~\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|(?:(?:>=|<=|>|<|=)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s+(?:>=|<=|>|<|=)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)*)$/.test(range)) {
    throw new Error(`requires.modules[${index}].range is not a supported semantic-version range`);
  }
  return {id, range, optional:Boolean(dep.optional)};
}

export function normalizeModuleManifest(input, options={}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Module manifest must be a JSON object');
  assertNoLegacyTenantKeys(input);
  const id = String(input.id || '').trim().toLowerCase();
  const name = String(input.name || '').trim();
  const version = String(input.version || '').trim();
  const kind = String(input.kind || 'declarative').trim().toLowerCase();
  if (!ID_RE.test(id)) throw new Error('Module id must use lowercase letters, numbers, dot, underscore or hyphen');
  if (!name) throw new Error('Module name is required');
  if (!SEMVER_RE.test(version)) throw new Error('Module version must be semver (for example 1.0.0)');
  if (!MODULE_KINDS.includes(kind)) throw new Error(`Module kind must be one of: ${MODULE_KINDS.join(', ')}`);
  const scope = input.scope && typeof input.scope === 'object' ? input.scope : {};
  const company_id = scope.company_id == null ? null : String(scope.company_id).trim();
  const contributes = input.contributes && typeof input.contributes === 'object' ? input.contributes : {};
  if (kind === 'declarative') assertNoExecutableFields(contributes);
  return {
    id,
    name,
    version,
    kind,
    description: String(input.description || '').trim(),
    author: String(input.author || '').trim(),
    scope: {company_id: company_id || null},
    permissions: stringArray(input.permissions, 'permissions'),
    authority: normalizeAuthority(input.authority),
    runtime: normalizeRuntimePolicy(input.runtime || {}),
    requires: {modules: normalizeList(input.requires?.modules, normalizeDependency)},
    contributes: {
      capabilities: Array.isArray(contributes.capabilities) ? clone(contributes.capabilities) : [],
      intents: normalizeList(contributes.intents, normalizeIntent),
      commands: normalizeList(contributes.commands, normalizeCommand),
      queries: normalizeList(contributes.queries, normalizeQuery),
      links: Array.isArray(contributes.links) ? clone(contributes.links) : [],
      feed: Array.isArray(contributes.feed) ? clone(contributes.feed) : [],
      settings: Array.isArray(contributes.settings) ? clone(contributes.settings) : [],
      screens: normalizeList(contributes.screens, normalizeScreen),
      workers: normalizeList(contributes.workers, normalizeWorker),
      tools: normalizeList(contributes.tools, normalizeTool),
      providers: normalizeList(contributes.providers, normalizeProvider),
      projections: normalizeList(contributes.projections, normalizeProjection),
      workflows: normalizeList(contributes.workflows, normalizeWorkflow),
      settingsPanels: normalizeList(contributes.settingsPanels, normalizeSettingsPanel),
      events: normalizeList(contributes.events, normalizeEventSubscription),
      verticals: normalizeList(contributes.verticals, normalizeVertical),
    },
    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {},
    source: String(options.source || input.source || 'runtime'),
  };
}

export function moduleAppliesToCompany(manifest, company_id=null) {
  const scoped = manifest?.scope?.company_id || null;
  if (!scoped) return true;
  return Boolean(company_id) && String(company_id) === String(scoped);
}

export function listModuleContributions(records, contributionType, company_id=null) {
  if (!CONTRIBUTION_TYPES.includes(contributionType)) throw new Error(`Unknown contribution type: ${contributionType}`);
  const items = [];
  for (const record of records || []) {
    if (!record?.enabled || ['blocked','error'].includes(record.status) || !record.manifest || !moduleAppliesToCompany(record.manifest, company_id)) continue;
    for (const contribution of record.manifest.contributes?.[contributionType] || []) {
      items.push({moduleId:record.manifest.id, moduleName:record.manifest.name, moduleVersion:record.manifest.version, ...clone(contribution)});
    }
  }
  return items;
}

export function getModuleContribution(records, contributionType, id, company_id=null, moduleId=null) {
  const targetId = String(id || '').trim();
  const targetModule = moduleId == null ? null : String(moduleId).trim().toLowerCase();
  return listModuleContributions(records, contributionType, company_id).find(item => item.id === targetId && (!targetModule || item.moduleId === targetModule)) || null;
}

function patternMatches(pattern, text) {
  const value = String(pattern || '').trim();
  if (!value) return false;
  if (value.startsWith('/') && value.lastIndexOf('/') > 0) {
    const last = value.lastIndexOf('/');
    const body = value.slice(1, last);
    const flags = value.slice(last + 1).replace(/[^gimsuy]/g, '');
    try { return new RegExp(body, flags.includes('i') ? flags : `${flags}i`).test(text); } catch { return false; }
  }
  return text.toLowerCase().includes(value.toLowerCase());
}

export function resolveModuleIntent(records, text, company_id=null) {
  const candidates = [];
  for (const record of records || []) {
    if (!record?.enabled || ['blocked','error'].includes(record.status) || !record.manifest || !moduleAppliesToCompany(record.manifest, company_id)) continue;
    for (const intent of record.manifest.contributes?.intents || []) {
      if (intent.patterns.some(pattern => patternMatches(pattern, String(text || '')))) {
        candidates.push({moduleId: record.manifest.id, moduleName: record.manifest.name, ...intent});
      }
    }
  }
  candidates.sort((a,b) => b.priority - a.priority || a.moduleId.localeCompare(b.moduleId));
  return candidates[0] || null;
}

export function applyIntentTransform(text, match) {
  const parts = [];
  if (match?.prepend) parts.push(match.prepend);
  parts.push(String(text || '').trim());
  if (match?.append) parts.push(match.append);
  return parts.filter(Boolean).join('\n\n');
}
