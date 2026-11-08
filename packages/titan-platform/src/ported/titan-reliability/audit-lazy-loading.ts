// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/audit-lazy-loading.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const size = p => fs.statSync(path.join(root, p)).size;
const exists = p => fs.existsSync(path.join(root, p));

const side = read('sidePanel.html');
const shell = read('titan-shell.js');
const manifest = JSON.parse(read('manifest.json'));
const chatTab = read('chatTab.html');

const aiTag = side.match(/<iframe[^>]+id=["']titan-ai-frame["'][^>]*>/i)?.[0] || '';
const aiDataSrc = aiTag.match(/data-src=["']([^"']+)["']/i)?.[1] || null;
const aiImmediateSrc = aiTag.match(/\ssrc=["']([^"']+)["']/i)?.[1] || null;
const chatScript = chatTab.match(/<script[^>]+src=["']([^"']+)["']/i)?.[1]?.replace(/^\.\//,'') || null;
const chatCss = chatTab.match(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/i)?.[1]?.replace(/^\.\//,'') || null;
const deferredBytes = [aiDataSrc, chatScript, chatCss].filter(Boolean).filter(exists).reduce((n,p)=>n+size(p),0);

const candidates = [
  {
    surface:'side_panel_hidden_ai_iframe',
    status:'IMPLEMENTED_SAFE_LAZY_BOUNDARY',
    trigger:'first AI tab activation',
    deferred_entrypoint:aiDataSrc,
    estimated_deferred_bytes:deferredBytes,
    reachability_guards:[
      'AI tab remains present and selected through existing setView flow',
      'ensureAiSurface restores chatTab.html on first AI activation',
      'Open full page link still targets chatTab.html directly',
      'Chat/Work/Agent frames are unchanged'
    ]
  },
  {
    surface:'service_worker_compatibility_boundary',
    status:'NOT_SAFE_TO_LAZY_LOAD_MONOLITH',
    files:['Titan chat compatibility background bundle','Retriever compatibility background bundle'],
    reason:'MV3 background compatibility engines register listeners during module evaluation; deferring them risks missing wake/event registration and Retriever reachability.'
  },
  {
    surface:'manifest_content_scripts',
    status:'NOT_SAFE_TO_LAZY_LOAD_MONOLITH',
    files:['content.js','content/all.iife.js','content-main/all.iife.js','titan-zero-chat-content.compat.js'],
    reason:'Manifest run_at/world semantics are part of page feature reachability; safe optimization requires bundle-level splitting rather than delaying the declared monoliths.'
  },
  {
    surface:'side_panel_chat_root',
    status:'REQUIRES_HANDSHAKE_BEFORE_LAZY_LOAD',
    files:['titan-zero-chat-content.compat.js'],
    reason:'Titan shell outcome bridge currently installs against #root at shell initialization. Deferring the chat bundle requires an explicit post-load bridge handshake before runtime behavior can be preserved.'
  }
];

const checks = [
  ['ai_iframe_has_data_src', aiDataSrc === 'chatTab.html'],
  ['ai_iframe_has_no_immediate_src', aiImmediateSrc === null],
  ['shell_has_ensure_ai_surface', /const ensureAiSurface\s*=/.test(shell)],
  ['shell_triggers_ai_lazy_load', /if \(name === 'ai'\) ensureAiSurface\(\)/.test(shell)],
  ['shell_sets_ai_src_from_data_src', /aiFrame\.setAttribute\('src', src\)/.test(shell)],
  ['chat_tab_reachable', exists('chatTab.html')],
  ['chat_script_reachable', !!chatScript && exists(chatScript)],
  ['chat_css_reachable', !!chatCss && exists(chatCss)],
  ['manifest_side_panel_titan_shell', manifest.side_panel?.default_path === 'sidePanel.html'],
  ['manifest_popup_titan_shell', manifest.action?.default_popup === 'titan-popup.html'],
  ['manifest_background_unchanged', manifest.background?.service_worker === 'background-bootstrap.js'],
  ['retriever_agent_boundary_retained', /id=["']titan-agent-frame["'][^>]+data-src=["']side-panel\/index\.html["']/.test(side)],
  ['work_frame_still_eager_for_outcome_bridge', /id=["']titan-work-frame["'][^>]+src=["']side-panel\/index\.html["']/.test(side)]
].map(([name, pass]) => ({name,pass:Boolean(pass)}));

const report = {
  schema:'titan-zero-lazy-loading-audit/v1',
  packet_id:'TZ-FINISH-005',
  pass:2,
  live_browser_claimed:false,
  candidates,
  implemented:{
    surface:'side_panel_hidden_ai_iframe',
    before:'chatTab.html loaded immediately with sidePanel.html',
    after:'chatTab.html loads on first AI tab activation',
    estimated_deferred_bytes:deferredBytes,
    deferred_files:[aiDataSrc,chatScript,chatCss].filter(Boolean)
  },
  checks,
  pass_all:checks.every(c=>c.pass)
};
process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
if (!report.pass_all) process.exitCode=1;
