// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-launcher-overlay.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
(()=>{
  if(window!==window.top)return;
  const existingHost=document.getElementById('titan-zero-launcher-host');
  if(existingHost){
    const ownedHost=existingHost.getAttribute?.('data-titan-zero-launcher')==='true'||!!existingHost.shadowRoot?.querySelector?.('.fab[aria-label=\"Open Titan Zero tools\"]');
    if(!ownedHost)return;
    try{existingHost.remove()}catch(_){}
  }
  const CONFIG_KEY='titanZeroThemeConfig';
  const DEFAULTS={background:'#05070b',primary:'#2563eb',secondary:'#64748b',tertiary:'#ec4899'};
  const validHex=(v,f)=>/^#[0-9a-f]{6}$/i.test(String(v||''))?String(v).toLowerCase():f;
  const normalize=(input={})=>({
    background:validHex(input.background,DEFAULTS.background),
    primary:validHex(input.primary,DEFAULTS.primary),
    secondary:validHex(input.secondary,DEFAULTS.secondary),
    tertiary:validHex(input.tertiary,DEFAULTS.tertiary)
  });
  let host,root;
  const apply=(brand=DEFAULTS)=>{
    if(!host)return;
    const b=normalize(brand);
    host.style.setProperty('--t0-background',b.background);
    host.style.setProperty('--t0-primary',b.primary);
    host.style.setProperty('--t0-secondary',b.secondary);
    host.style.setProperty('--t0-tertiary',b.tertiary);
  };
  const load=async()=>{
    try{const stored=await chrome.storage.local.get(CONFIG_KEY);apply(stored?.[CONFIG_KEY]?.brand||DEFAULTS)}catch(_){apply(DEFAULTS)}
  };
  const mount=()=>{
    if(!document.documentElement||document.getElementById('titan-zero-launcher-host'))return;
    host=document.createElement('div');host.id='titan-zero-launcher-host';host.setAttribute('data-titan-zero-launcher','true');root=host.attachShadow({mode:'open'});
    root.innerHTML=`<style>:host{all:initial;--t0-background:#05070b;--t0-primary:#2563eb;--t0-secondary:#64748b;--t0-tertiary:#ec4899;--t0-panel:#0f172a;--t0-line:#334155;--t0-text:#e2e8f0;--t0-muted:#94a3b8;--t0-soft:#1e293b}.wrap{font:12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;position:relative}.fab{width:42px;height:42px;border:1px solid var(--t0-primary);border-radius:14px;background:var(--t0-background);color:#fff;box-shadow:0 8px 28px rgba(2,6,23,.3),inset 0 -2px 0 var(--t0-tertiary);font-weight:800;cursor:pointer}.fab:hover{box-shadow:0 8px 28px rgba(2,6,23,.3),0 0 0 2px color-mix(in srgb,var(--t0-primary) 40%,transparent)}.menu{position:absolute;right:0;bottom:50px;width:184px;padding:7px;border:1px solid var(--t0-line);border-radius:12px;background:var(--t0-panel);box-shadow:0 10px 30px rgba(2,6,23,.36)}.menu[hidden]{display:none}.menu button{display:block;width:100%;box-sizing:border-box;border:0;border-radius:8px;background:transparent;color:var(--t0-text);text-align:left;padding:8px;cursor:pointer}.menu button:hover{background:var(--t0-soft);box-shadow:inset 2px 0 0 var(--t0-primary)}.label{padding:5px 8px;color:var(--t0-secondary);font-size:10px}</style><div class="wrap"><button class="fab" aria-label="Open Titan Zero tools" aria-expanded="false">T0</button><div class="menu" hidden><div class="label">Titan Zero</div><button data-action="ai">AI Workspace</button><button data-tool="search">Search the web</button><button data-tool="webpage_assistant">Ask about this page</button><button data-tool="text_selection" data-selection-only="true" hidden>Ask about selection</button><button data-action="retriever">Titan Runtime</button><button data-action="tools">Titan AI Tools</button><button data-action="options">Settings</button></div></div>`;
    const fab=root.querySelector('.fab'),menu=root.querySelector('.menu');
    fab.addEventListener('click',()=>{const next=!menu.hidden;menu.hidden=next;fab.setAttribute('aria-expanded',String(!next))});
    root.querySelectorAll('[data-action]').forEach(btn=>btn.addEventListener('click',async()=>{menu.hidden=true;fab.setAttribute('aria-expanded','false');try{await chrome.runtime.sendMessage({type:'TITAN_LAUNCHER',action:btn.dataset.action,target:'Chat'})}catch(_){}}));
    const selectedText=()=>String(window.getSelection?.()?.toString?.()||'').trim().slice(0,12000);
    const refreshSelectionAction=()=>{const btn=root.querySelector('[data-selection-only]');if(btn)btn.hidden=!selectedText()};
    document.addEventListener('selectionchange',refreshSelectionAction,{passive:true});
    fab.addEventListener('click',refreshSelectionAction);
    root.querySelectorAll('[data-tool]').forEach(btn=>btn.addEventListener('click',async()=>{
      menu.hidden=true;fab.setAttribute('aria-expanded','false');
      const selectionText=selectedText();
      try{await chrome.runtime.sendMessage({type:'TITAN_TOOL_LAUNCH',tool_id:btn.dataset.tool,page_url:location.href,page_title:document.title,selectionText})}catch(_){}
    }));
    document.documentElement.appendChild(host);load();
  };
  try{chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes?.[CONFIG_KEY])apply(changes[CONFIG_KEY].newValue?.brand||DEFAULTS)})}catch(_){}
  if(document.documentElement)mount();else document.addEventListener('readystatechange',mount,{once:true});
})();
