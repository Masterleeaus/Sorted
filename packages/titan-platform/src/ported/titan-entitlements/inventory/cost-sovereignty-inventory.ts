// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-entitlements/inventory/cost-sovereignty-inventory.mjs
import fs from 'node:fs';
import path from 'node:path';

const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html']);
const DEFAULT_SKIP_DIRS = new Set(['.git', 'node_modules']);
const PROVIDER_PATTERN = /\b(openai|anthropic|gemini|deepseek|openrouter|ollama|perplexity|groq|mistral|together|providerConfigs?)\b/gi;
const NETWORK_PATTERN = /\bfetch\s*\(|XMLHttpRequest|axios(?:\.|\s*\()|chrome\.runtime\.sendMessage|chrome\.tabs\.sendMessage/g;
const COST_PATTERN = /\b(cost|budget|creditCeiling|freeMode|metered|entitlement|usage[_ -]?receipt|actual_cost|estimated_cost)\b/gi;
const ROUTING_GUARD_PATTERN = /buildWorkforceIntelligenceRoutingPolicy|selectWorkforceIntelligenceRoute|buildWorkforceProviderReceipt|evaluateWorkforceResourceRequest|recordWorkforceResourceConsumption|buildAICostRoutePreferencePlan|buildAICostRoutingPolicyProjection/g;
const SETTINGS_ROUTE_PATTERN = /aiCostRoutingPreferences|aiTitanManagedUsagePolicy|aiProviderFallbackPolicy|freeModeEnabled|creditCeilingEnabled|creditCeiling/g;
const COMPANY_PATTERN = /\bcompany_id\b/g;

function count(pattern, text) {
  pattern.lastIndex = 0;
  let total = 0;
  while (pattern.exec(text)) total += 1;
  pattern.lastIndex = 0;
  return total;
}

function classify(relPath) {
  if (relPath.startsWith('tests/')) return 'test';
  if (relPath.startsWith('titan-entitlements/inventory/')) return 'development_inventory';
  if (relPath.startsWith('side-panel/') || relPath.startsWith('offscreen/assets/') || relPath.startsWith('static/')) return 'bundled_or_donor_runtime';
  if (/^(TITAN-|PASS\d|VERIFICATION|CHANGELOG|README|docs\/)/.test(relPath)) return 'evidence_or_docs';
  return 'first_party_runtime_or_config';
}

function walk(root, { maxFileBytes = 1_000_000 } = {}) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (DEFAULT_SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) continue;
      const stat = fs.statSync(full);
      if (stat.size > maxFileBytes) continue;
      out.push({ full, size_bytes: stat.size, rel: path.relative(root, full).split(path.sep).join('/') });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function findStartupReachability(root) {
  const manifestPath = path.join(root, 'manifest.json');
  const bootstrapPath = path.join(root, 'background-bootstrap.js');
  let serviceWorker = null;
  let bootstrap = '';
  if (fs.existsSync(manifestPath)) {
    try { serviceWorker = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))?.background?.service_worker ?? null; } catch {}
  }
  if (fs.existsSync(bootstrapPath)) bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
  return {
    service_worker: serviceWorker,
    workforce_runtime_imported: /runtime\/workforce-runtime-background\.mjs/.test(bootstrap),
    native_runtime_imported: /runtime\/native-runtime-background\.mjs/.test(bootstrap),
    settings_cost_module_imported_by_bootstrap: /ai-cost-routing-settings\.mjs/.test(bootstrap),
    provider_control_module_imported_by_bootstrap: /ai-provider-control-centre\.mjs/.test(bootstrap),
  };
}

export function buildCostSovereigntyInventory(root, options = {}) {
  const absRoot = path.resolve(root);
  const files = walk(absRoot, options);
  const records = [];
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file.full, 'utf8'); } catch { continue; }
    const metrics = {
      network_calls: count(NETWORK_PATTERN, text),
      provider_refs: count(PROVIDER_PATTERN, text),
      cost_hints: count(COST_PATTERN, text),
      routing_guard_refs: count(ROUTING_GUARD_PATTERN, text),
      settings_route_refs: count(SETTINGS_ROUTE_PATTERN, text),
      company_id_refs: count(COMPANY_PATTERN, text),
    };
    if (!Object.values(metrics).some(Boolean)) continue;
    records.push({ path: file.rel, class: classify(file.rel), size_bytes: file.size_bytes, ...metrics });
  }

  const firstParty = records.filter((r) => r.class === 'first_party_runtime_or_config');
  const guarded = firstParty.filter((r) => r.routing_guard_refs > 0);
  const networkProviderCandidates = records.filter((r) => r.network_calls > 0 && r.provider_refs > 0 && !['test', 'evidence_or_docs', 'development_inventory'].includes(r.class));
  const costAware = firstParty.filter((r) => r.cost_hints > 0 || r.settings_route_refs > 0 || r.routing_guard_refs > 0);
  const runtimeGuardFiles = new Set(guarded.map((r) => r.path));

  const knownCore = [
    'titan-settings/control-plane/ai-cost-routing-settings.js',
    'titan-settings/control-plane/ai-provider-control-centre.js',
    'titan-settings/control-plane/ai-budget-controls.js',
    'titan-workforce/handover/investigation-installation-handover.js',
    'runtime/workforce-runtime-background.js',
  ].map((p) => ({ path: p, exists: fs.existsSync(path.join(absRoot, p)), guarded: runtimeGuardFiles.has(p) }));

  const startup = findStartupReachability(absRoot);
  const gaps = [];
  if (fs.existsSync(path.join(absRoot, 'titan-settings/control-plane/ai-cost-routing-settings.js')) && !startup.settings_cost_module_imported_by_bootstrap) {
    gaps.push('settings-cost-routing-projection-not-directly-imported-by-service-worker-bootstrap');
  }
  if (fs.existsSync(path.join(absRoot, 'titan-settings/control-plane/ai-provider-control-centre.js')) && !startup.provider_control_module_imported_by_bootstrap) {
    gaps.push('provider-control-centre-not-directly-imported-by-service-worker-bootstrap');
  }
  if (networkProviderCandidates.some((r) => r.class === 'bundled_or_donor_runtime')) {
    gaps.push('bundled-provider-network-call-sites-require-adapter-level-entitlement-preflight-verification');
  }
  if (networkProviderCandidates.some((r) => r.class === 'first_party_runtime_or_config' && r.routing_guard_refs === 0)) {
    gaps.push('first-party-network-provider-call-sites-exist-without-local-routing-guard-reference-in-same-file');
  }

  return {
    schema: 'titan-zero-cost-sovereignty-inventory/v1',
    generated_at: new Date().toISOString(),
    root: '.',
    scope: {
      max_file_bytes: options.maxFileBytes ?? 1_000_000,
      code_extensions: [...CODE_EXTENSIONS].sort(),
      note: 'Static inventory only. A candidate is not proof of an outbound paid call; live execution must still be traced and tested.'
    },
    startup,
    summary: {
      scanned_files: files.length,
      matched_files: records.length,
      first_party_matched_files: firstParty.length,
      guarded_first_party_files: guarded.length,
      cost_aware_first_party_files: costAware.length,
      provider_network_candidate_files: networkProviderCandidates.length,
    },
    known_core: knownCore,
    gaps: [...new Set(gaps)].sort(),
    provider_network_candidates: networkProviderCandidates
      .sort((a, b) => (b.network_calls + b.provider_refs) - (a.network_calls + a.provider_refs) || a.path.localeCompare(b.path))
      .slice(0, 100),
    guarded_files: guarded.sort((a, b) => a.path.localeCompare(b.path)),
    cost_aware_files: costAware.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function writeCostSovereigntyInventory(root, outputPath, options = {}) {
  const inventory = buildCostSovereigntyInventory(root, options);
  fs.writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`);
  return inventory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const out = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'TITAN-ZERO-TZ-NEXT-017-PASS01-INVENTORY.json');
  const inventory = writeCostSovereigntyInventory(root, out);
  process.stdout.write(`${JSON.stringify(inventory.summary)}\n`);
}
