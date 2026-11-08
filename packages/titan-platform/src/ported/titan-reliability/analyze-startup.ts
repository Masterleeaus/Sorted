// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/analyze-startup.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const budgets = JSON.parse(fs.readFileSync(path.join(here, 'performance-budgets.json'), 'utf8'));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const size = p => fs.statSync(path.join(root, p)).size;
const exists = p => fs.existsSync(path.join(root, p));

function resolveImport(from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.normalize(path.join(path.dirname(from), specifier));
  const candidates = [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js'), path.join(base, 'index.js')];
  return candidates.find(exists) || null;
}

function importClosure(entrypoint) {
  const queue = [entrypoint];
  const seen = new Set();
  const importRe = /(?:import\s+(?:[^'\"]+?\s+from\s+)?|import\s*)['\"]([^'\"]+)['\"]/g;
  while (queue.length) {
    const current = queue.pop();
    if (!current || seen.has(current) || !exists(current)) continue;
    seen.add(current);
    const source = read(current);
    for (const match of source.matchAll(importRe)) {
      const resolved = resolveImport(current, match[1]);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  const files = [...seen].sort();
  return { files, bytes: files.reduce((sum, f) => sum + size(f), 0) };
}

function directScripts(htmlPath) {
  const html = read(htmlPath);
  const matches = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1].replace(/^\.\//, ''));
  const files = matches.filter(exists);
  return { files, count: files.length, bytes: files.reduce((sum, f) => sum + size(f), 0), htmlBytes: size(htmlPath) };
}

const manifest = JSON.parse(read('manifest.json'));
const swEntry = manifest.background?.service_worker;
const sideEntry = manifest.side_panel?.default_path;
const popupEntry = manifest.action?.default_popup;
const sw = importClosure(swEntry);
const side = directScripts(sideEntry);
const popup = directScripts(popupEntry);
const actionBytes = popup.htmlBytes + popup.bytes;

const checks = [
  ['manifest.service_worker', swEntry === budgets.surfaces.service_worker.entrypoint, swEntry, budgets.surfaces.service_worker.entrypoint],
  ['manifest.side_panel', sideEntry === budgets.surfaces.side_panel.entrypoint, sideEntry, budgets.surfaces.side_panel.entrypoint],
  ['manifest.action_popup', popupEntry === budgets.surfaces.action.manifest_action_popup, popupEntry, budgets.surfaces.action.manifest_action_popup],
  ['service_worker.bootstrap_bytes', size(swEntry) <= budgets.surfaces.service_worker.bootstrap_max_bytes, size(swEntry), budgets.surfaces.service_worker.bootstrap_max_bytes],
  ['service_worker.closure_bytes', sw.bytes <= budgets.surfaces.service_worker.closure_max_bytes, sw.bytes, budgets.surfaces.service_worker.closure_max_bytes],
  ['service_worker.closure_files', sw.files.length <= budgets.surfaces.service_worker.closure_max_files, sw.files.length, budgets.surfaces.service_worker.closure_max_files],
  ['side_panel.html_bytes', side.htmlBytes <= budgets.surfaces.side_panel.html_max_bytes, side.htmlBytes, budgets.surfaces.side_panel.html_max_bytes],
  ['side_panel.direct_script_count', side.count <= budgets.surfaces.side_panel.direct_script_max_count, side.count, budgets.surfaces.side_panel.direct_script_max_count],
  ['side_panel.direct_script_bytes', side.bytes <= budgets.surfaces.side_panel.direct_script_max_bytes, side.bytes, budgets.surfaces.side_panel.direct_script_max_bytes],
  ['popup.html_bytes', popup.htmlBytes <= budgets.surfaces.popup.html_max_bytes, popup.htmlBytes, budgets.surfaces.popup.html_max_bytes],
  ['popup.direct_script_count', popup.count <= budgets.surfaces.popup.direct_script_max_count, popup.count, budgets.surfaces.popup.direct_script_max_count],
  ['popup.direct_script_bytes', popup.bytes <= budgets.surfaces.popup.direct_script_max_bytes, popup.bytes, budgets.surfaces.popup.direct_script_max_bytes],
  ['action.initial_payload_bytes', actionBytes <= budgets.surfaces.action.initial_payload_max_bytes, actionBytes, budgets.surfaces.action.initial_payload_max_bytes]
].map(([name, pass, actual, max]) => ({ name, pass, actual, max }));

const report = {
  schema: 'titan-zero-performance-budget-report/v1',
  packet_id: 'TZ-FINISH-005',
  pass: 1,
  live_timing_claimed: false,
  service_worker: { entrypoint: swEntry, bootstrap_bytes: size(swEntry), closure_bytes: sw.bytes, closure_files: sw.files.length },
  side_panel: { entrypoint: sideEntry, html_bytes: side.htmlBytes, direct_script_count: side.count, direct_script_bytes: side.bytes },
  popup: { entrypoint: popupEntry, html_bytes: popup.htmlBytes, direct_script_count: popup.count, direct_script_bytes: popup.bytes },
  action: { popup: popupEntry, initial_payload_bytes: actionBytes },
  checks,
  pass_all: checks.every(c => c.pass)
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.pass_all) process.exitCode = 1;
