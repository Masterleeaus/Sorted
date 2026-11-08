// @ts-nocheck
// Ported from Titan Zero extension (portable-core): scripts/workforce-browser-live-smoke.mjs
#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

const extensionDir=path.resolve(process.argv[2]||'.');
const output=path.resolve(process.argv[3]||'TITAN-ZERO-WORKFORCE-PASS46-BROWSER-LIVE-SMOKE-RESULT.json');
const chromium=process.env.CHROMIUM_BIN||'/usr/bin/chromium';
const port=9236;
const profile=await mkdtemp(path.join(tmpdir(),'titan-zero-browser-smoke-'));
const getJson=url=>new Promise((resolve,reject)=>{http.get(url,r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{try{resolve(JSON.parse(b))}catch(e){reject(e)}})}).on('error',reject)});
const child=spawn(chromium,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`,`--load-extension=${extensionDir}`,'about:blank'],{stdio:['ignore','ignore','ignore']});
await new Promise(r=>setTimeout(r,2500));
let version=null,targets=[];
try{version=await getJson(`http://127.0.0.1:${port}/json/version`);targets=await getJson(`http://127.0.0.1:${port}/json/list`);}catch{}
const extensionTargets=targets.filter(t=>String(t.url||'').startsWith('chrome-extension://')||t.type==='service_worker');
const result={schema:'titan.workforce.browser-live-smoke-observation.v1',observed_at:new Date().toISOString(),browser:{process_started:child.exitCode===null,name:'Chromium',version:version?.Browser||'',evidence_refs:['browser:chromium-process','browser:devtools-version']},extension:{target_observed:extensionTargets.some(t=>String(t.url||'').startsWith('chrome-extension://')),service_worker_observed:extensionTargets.some(t=>t.type==='service_worker'),evidence_refs:extensionTargets.map(t=>`${t.type}:${t.url}`)},ui:{rich_startup_rendered:false,workforce_launcher_reached:false,evidence_refs:[]},runtime:{message_round_trip:false,evidence_refs:[]},limitations:extensionTargets.length?[]:['Chromium headless exposed DevTools but did not load the unpacked extension; no live extension target was observed. Run against an extension-enabled interactive Chromium target for full certification.'],authority_granted:false,execution_permitted:false,grants_authority:false};
await writeFile(output,JSON.stringify(result,null,2));
child.kill('SIGTERM');await new Promise(r=>setTimeout(r,250));if(child.exitCode===null)child.kill('SIGKILL');await rm(profile,{recursive:true,force:true});
console.log(JSON.stringify(result));
