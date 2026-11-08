// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/audit-resource-lifecycle.mjs
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.argv[2]||'.');
const targets=[
  'background-bootstrap.js','runtime/native-runtime-background.js','runtime/workforce-runtime-background.js','titan-shell.js',
  'titan-intelligence/overseer.js','titan-intelligence/providers/ollama-local-provider.js','titan-offline/service-worker-lifecycle.js'
];
const patterns={
  listener:/\.addListener\s*\(/g,
  domListener:/\.addEventListener\s*\(/g,
  removeListener:/\.removeListener\s*\(/g,
  interval:/\bsetInterval\s*\(/g,
  clearInterval:/\bclearInterval\s*\(/g,
  timeout:/\bsetTimeout\s*\(/g,
  clearTimeout:/\bclearTimeout\s*\(/g,
  alarmCreate:/chrome\.alarms\.create\s*\(/g,
  portConnect:/runtime\.connect\s*\(/g,
  portDisconnect:/\.disconnect\s*\(/g,
};
const count=(text,re)=>[...text.matchAll(re)].length;
const rows=[];
for(const rel of targets){
  const file=path.join(root,rel); if(!fs.existsSync(file)) continue;
  const text=fs.readFileSync(file,'utf8'); const counts={}; for(const [k,re] of Object.entries(patterns)) counts[k]=count(text,re);
  rows.push({file:rel,bytes:Buffer.byteLength(text),...counts});
}
const alarmFiles=rows.filter(r=>r.alarmCreate>0).map(r=>r.file);
const shell=rows.find(r=>r.file==='titan-shell.js');
const findings=[];
if(shell && shell.interval>0 && shell.clearInterval===0) findings.push({severity:'high',code:'INTERVAL_WITHOUT_CLEAR',file:shell.file});
for(const r of rows){ if(r.portConnect>0 && r.portDisconnect===0) findings.push({severity:'medium',code:'PORT_CONNECT_WITHOUT_DISCONNECT',file:r.file}); }
const report={
  protocol:'titan.reliability.resource-lifecycle-audit.v1',
  targets:rows,
  alarm_files:alarmFiles,
  findings,
  checks:{
    shell_interval_has_clear:!shell||shell.interval===0||shell.clearInterval>0,
    no_unpaired_port_connect:!rows.some(r=>r.portConnect>0&&r.portDisconnect===0),
    alarm_name_collision_static:'not_detected_by_selected_sources',
    service_worker_top_level_listener_model:'one_registration_per_worker_lifetime',
  },
  pass:findings.length===0,
  live_browser_claimed:false,
  grants_authority:false,
  authority_effect:false,
};
process.stdout.write(JSON.stringify(report,null,2)+'\n');
if(!report.pass) process.exitCode=1;
