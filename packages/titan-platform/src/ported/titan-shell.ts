// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-shell.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero persistent diagnostics capture */
(()=>{const KEY='titanDiagnosticLog',MAX=1000;const safe=v=>{try{return typeof v==='string'?v:JSON.stringify(v)}catch{return String(v)}};window.titanDiagWrite=async(level,source,message,detail={})=>{try{const d=await chrome.storage.local.get([KEY]);const log=Array.isArray(d[KEY])?d[KEY]:[];log.push({ts:new Date().toISOString(),level,source,message,detail});await chrome.storage.local.set({[KEY]:log.slice(-MAX)})}catch(_){}};window.addEventListener('error',e=>window.titanDiagWrite('error','shell',e.message,{filename:e.filename,line:e.lineno,column:e.colno,stack:e.error?.stack}));window.addEventListener('unhandledrejection',e=>window.titanDiagWrite('error','shell','Unhandled promise rejection',{reason:safe(e.reason),stack:e.reason?.stack}));})();

/* Titan Zero shell + business operating workspace */
(() => {
  const STORAGE = {
    view: 'titanZeroView',
    legacyView: 'titanZeroDemoView',
    context: 'titanSharedContext',
    feedRead: 'titanFeedRead',
    businessProfile: 'titanBusinessProfile',
    workState: 'titanWorkFrameState',
    aiTarget: 'titanAiWorkspaceTarget'
  };

  const views = {
    chat: document.getElementById('titan-chat-view'),
    ai: document.getElementById('titan-ai-view'),
    business: document.getElementById('titan-business-view'),
    feed: document.getElementById('titan-feed-view'),
    workforce: document.getElementById('titan-workforce-view'),
    agent: document.getElementById('titan-agent-view'),
    work: document.getElementById('titan-work-view')
  };
  // Explicit launcher state always wins over persisted workspace state. This prevents an
  // old `titanZeroView=ai` value from overriding a requested Business/Workforce/etc. route.
  const launchQuery = new URLSearchParams(location.search);
  const requestedLaunchView = String(launchQuery.get('view') || '').trim();
  const launchView = requestedLaunchView && views[requestedLaunchView] ? requestedLaunchView : null;
  const launchAiTarget = String(launchQuery.get('target') || '').trim() || null;
  const launchFullscreen = launchQuery.get('fullscreen') === '1';
  const tabs = [...document.querySelectorAll('.titan-tab')];
  const frame = document.getElementById('titan-work-frame');
  const agentFrame = document.getElementById('titan-agent-frame');
  const agentFallback = document.getElementById('titan-agent-fallback');
  const workStatus = document.getElementById('titan-work-status');
  const drawer = document.getElementById('titan-detail-drawer');
  const diagnosticsPanel = document.getElementById('titan-diagnostics-panel');
  const workFallback = document.getElementById('titan-work-fallback');
  const contextCopy = document.querySelector('.context-copy');
  const feedList = document.getElementById('titan-feed-list');
  const aiFrame = document.getElementById('titan-ai-frame');
  const aiWorkspaceStatus = document.getElementById('titan-ai-workspace-status');
  const aiWorkspaceButtons = [...document.querySelectorAll('[data-ai-target]')];

  let selectedFeedItem = null;
  let activeFilter = 'all';
  let readIds = new Set();
  let feedItems = [];
  let outcomeHistory = [];
  let businessProfile = null;
  let workFrameState = 'unknown';

  const escapeHtml = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const save = async (obj) => { try { await chrome.storage.local.set(obj); return true; } catch (e) { window.titanDiagWrite?.('error','shell','Storage write failed',{message:e.message}); return false; } };
  const businessStateMessage = async (action, { company_id, domain, record, options } = {}) => {
    const canonicalCompanyId = String(company_id || businessProfile?.company_id || '').trim();
    if (!canonicalCompanyId) throw new Error('Titan business state requires company_id');
    const response = await chrome.runtime.sendMessage({
      type: 'TITAN_BUSINESS_STATE',
      action,
      context: { company_id: canonicalCompanyId, actor_id: 'user:titan-shell' },
      domain,
      record,
      options: options || {},
    });
    if (!response?.ok) throw new Error(response?.error || `Titan business state ${action} failed`);
    return response.result;
  };
  const listBusinessState = async (domain, company_id = businessProfile?.company_id) => {
    const records = await businessStateMessage('list', { company_id, domain, options: { limit: 10000 } });
    return Array.isArray(records) ? records : [];
  };
  const generatedCompanyId = () => `company-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2,10)}`}`;

  // company_id is the sole canonical company boundary for Titan-owned extension state.
  function normalizeBusinessProfile(raw={}) {
    const company_id = String(raw?.company_id || '').trim() || generatedCompanyId();
    const name = String(raw?.name || raw?.company_name || '').trim() || 'My Business';
    return { company_id, name: name.slice(0,120), updatedAt: Number(raw?.updatedAt) || Date.now() };
  }

  const isValidCompanyId = value => /^[A-Za-z0-9._:-]{2,128}$/.test(String(value || '').trim());

  async function ensureBusinessProfile(data={}) {
    const hadProfile = !!data[STORAGE.businessProfile]?.company_id;
    const profile = normalizeBusinessProfile(data[STORAGE.businessProfile]);
    if (!hadProfile) {
      await save({ [STORAGE.businessProfile]: profile });
      window.titanDiagWrite?.('info','business','Created canonical local company boundary',{company_id:profile.company_id});
    }
    return profile;
  }

  const DEMO_FEED_VERSION = 1;
  const buildDemoFeed = company_id => {
    const now=Date.now();
    return [
      {id:'demo-urgent-invoice',company_id,demo:true,urgency:'urgent',tone:'attention',icon:'!',kind:'Finance',action:'approval',title:'Invoice #1842 is 11 days overdue',summary:'Accounts Receivable Worker recommends a customer follow-up today.',unread:true,at:now-8*60000,meta:['$2,480 outstanding','Accounts Receivable','Demo']},
      {id:'demo-manager-escalation',company_id,demo:true,urgency:'urgent',tone:'attention',icon:'!',kind:'Workforce',action:'workflow',title:'Supervisor escalation: tomorrow is over capacity',summary:'Operations Supervisor found two jobs without an assigned field worker.',unread:true,at:now-19*60000,meta:['2 jobs','Operations Supervisor','Demo']},
      {id:'demo-lead-followup',company_id,demo:true,urgency:'important',tone:'progress',icon:'↗',kind:'Revenue',action:'workflow',title:'Three warm leads need follow-up',summary:'Customer Communications Worker prepared the highest-value follow-up queue.',unread:true,at:now-43*60000,meta:['3 leads','$6.4k potential','Demo']},
      {id:'demo-qa-review',company_id,demo:true,urgency:'important',tone:'progress',icon:'◎',kind:'Quality',action:'approval',title:'Completion evidence ready for review',summary:'Quality Coordinator has before/after evidence for the Carlton job.',unread:false,at:now-78*60000,meta:['Carlton','Quality Coordinator','Demo']},
      {id:'demo-booking-complete',company_id,demo:true,urgency:'normal',tone:'insight',icon:'✓',kind:'Booking',action:'workflow',title:'New booking confirmed',summary:'Booking Coordinator confirmed Friday 10:30 AM and updated the work queue.',unread:false,at:now-132*60000,meta:['Friday 10:30','Booking Coordinator','Demo']},
      {id:'demo-automation',company_id,demo:true,urgency:'normal',tone:'insight',icon:'✓',kind:'Improvement',action:'workflow',title:'Repetitive admin task identified',summary:'Chief of Staff found a safe candidate for approval-based automation.',unread:false,at:now-210*60000,meta:['12 min/day opportunity','Chief of Staff','Demo']}
    ];
  };
  async function seedDemoOperationalDataIfEmpty(profile, currentFeed=[]){
    const current=Array.isArray(currentFeed)?currentFeed.filter(x=>x?.company_id===profile.company_id):[];
    if(current.length) return current;
    const demo=buildDemoFeed(profile.company_id);
    for (const item of demo) {
      await businessStateMessage('commit', { company_id: profile.company_id, domain: 'activity', record: item, options: { entity_id: item.id, source: 'titan-shell-demo' } });
    }
    await save({titanDemoFeedVersion:DEMO_FEED_VERSION});
    return listBusinessState('activity', profile.company_id);
  }

  const setView = (name) => {
    if (!views[name]) name = 'chat';
    Object.entries(views).forEach(([key, el]) => el?.classList.toggle('active', key === name));
    tabs.forEach(btn => btn.classList.toggle('active', btn.dataset.view === name));
    document.body.dataset.titanView = name;
    save({ [STORAGE.view]: name });
    if (name === 'ai') ensureAiSurface();
    if (name === 'business') renderBusiness();
    if (name === 'workforce') renderWorkforce?.();
    if (name === 'agent') ensureAgentSurface();
  };

  const ensureAiSurface = () => {
    if (!aiFrame || aiFrame.getAttribute('src')) return;
    const src = aiFrame.dataset.src || 'chatTab.html';
    aiFrame.setAttribute('src', src);
    window.titanDiagWrite?.('info','performance','Lazy-loaded retained Titan AI compatibility surface',{surface:'ai',src});
  };

  window.addEventListener('message', async event => {
    if (!aiFrame?.contentWindow || event.source !== aiFrame.contentWindow) return;
    const message = event.data || {};
    if (message.type !== 'TITAN_OPEN_WORKFORCE_MANAGEMENT' && message.type !== 'TITAN_WORKFORCE_AGENT_ACTION') return;
    if (message.type === 'TITAN_OPEN_WORKFORCE_MANAGEMENT') {
      setView('workforce');
      window.titanDiagWrite?.('info','workforce-ui','Opened Workforce management from Workforce Agents catalogue',{source:'workforce-agents-profile'});
      return;
    }
    const company_id = String(message.company_id || '').trim();
    const currentCompany = String(businessProfile?.company_id || '').trim();
    const worker_id = String(message.worker_id || '').trim();
    const label = String(message.label || worker_id || 'Workforce Agent').trim();
    const action = String(message.action || '').trim();
    if (!isValidCompanyId(company_id) || company_id !== currentCompany || !worker_id) {
      window.titanDiagWrite?.('warn','workforce-ui','Rejected Workforce Agent action outside active company boundary',{action,company_id,current_company_id:currentCompany,worker_id});
      return;
    }
    try {
      if (action === 'launch' || action === 'use') {
        window.TitanWorkforce?.setPreferredWorker?.(worker_id);
        await save({titanWorkforceAgentSelection:{company_id,worker_id,label,selected_at:new Date().toISOString(),grants_authority:false}});
        if (action === 'launch') await openAiWorkspaceTarget('Chat');
        window.titanDiagWrite?.('info','workforce-ui','Selected Workforce Agent for Titan interaction',{action,company_id,worker_id,label,grants_authority:false});
        return;
      }
      if (action === 'assign') {
        await window.TitanClientWorkforceControls?.prepareWorkerControl?.('request_assignment_review',worker_id,label);
        setView('workforce');
        window.titanDiagWrite?.('info','workforce-ui','Prepared governed assignment review from Workforce Agent profile',{company_id,worker_id,label,grants_authority:false});
        return;
      }
      if (action === 'configure') {
        setView('workforce');
        window.titanDiagWrite?.('info','workforce-ui','Opened Workforce management to configure Workforce Agent',{company_id,worker_id,label,grants_authority:false});
      }
    } catch (error) {
      window.titanDiagWrite?.('error','workforce-ui','Workforce Agent profile action failed',{action,company_id,worker_id,error:String(error?.message||error)});
    }
  });

  const normalizeAiLabel = value => String(value || '').replace(/\s+/g,' ').trim().toLowerCase();
  const aiTargetAliases = {
    Chat:['chat','home','new chat'],
    WorkforceAgents:['workforce agents'],
    Explore:['explore','discover'],
    Create:['create','create workforce agent','create with ai'],
    History:['history','chats','recent'],
    Models:['models','model','select model'],
    Tools:['tools','toolbox','all tools']
  };

  const setAiWorkspaceStatus = (message, tone='neutral') => {
    if (!aiWorkspaceStatus) return;
    aiWorkspaceStatus.textContent = message;
    aiWorkspaceStatus.dataset.tone = tone;
  };

  function findAiWorkspaceControl(doc, target) {
    if (!doc) return null;
    const aliases = (aiTargetAliases[target] || [target]).map(normalizeAiLabel);
    const candidates = [...doc.querySelectorAll('button,a,[role="button"],[role="tab"],[aria-label],[title]')];
    let fallback = null;
    for (const node of candidates) {
      const values = [node.textContent,node.getAttribute('aria-label'),node.getAttribute('title')].map(normalizeAiLabel).filter(Boolean);
      if (!values.length) continue;
      if (values.some(value => aliases.includes(value))) return node;
      if (!fallback && values.some(value => aliases.some(alias => alias.length > 3 && value.includes(alias)))) fallback = node;
    }
    return fallback;
  }

  async function openAiWorkspaceTarget(target) {
    if (!aiFrame) return false;
    ensureAiSurface();
    const cleanTarget = String(target || 'Chat');
    aiWorkspaceButtons.forEach(button => {
      const active = button.dataset.aiTarget === cleanTarget;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',active ? 'true' : 'false');
    });
    setView('ai');
    setAiWorkspaceStatus(`Opening ${cleanTarget} in retained Titan AI workspace…`);
    const attempt = () => {
      try {
        const doc = aiFrame.contentDocument;
        const control = findAiWorkspaceControl(doc, cleanTarget);
        if (control) {
          control.click();
          setAiWorkspaceStatus(`${cleanTarget} is open in the retained AI workspace`,'ok');
          window.titanDiagWrite?.('info','ai-workspace','Opened retained AI workspace section',{target:cleanTarget});
          return true;
        }
        if (cleanTarget === 'Chat') {
          setAiWorkspaceStatus('Chat workspace is open','ok');
          return true;
        }
      } catch (error) {
        window.titanDiagWrite?.('warn','ai-workspace','Unable to inspect retained AI frame',{target:cleanTarget,error:String(error?.message||error)});
      }
      return false;
    };
    if (attempt()) return true;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (attempt() || tries >= 12) {
        clearInterval(timer);
        if (tries >= 12) setAiWorkspaceStatus(`${cleanTarget} remains available inside the retained AI workspace; open it from the workspace navigation.`,'attention');
      }
    },250);
    return false;
  }

  aiWorkspaceButtons.forEach(button => button.addEventListener('click', () => openAiWorkspaceTarget(button.dataset.aiTarget)));
  aiFrame?.addEventListener('load', () => {
    setAiWorkspaceStatus('Full retained conversation workspace loaded','ok');
    window.titanDiagWrite?.('info','ai-workspace','Retained Monica-derived conversation workspace loaded',{surface:'ai',src:aiFrame.getAttribute('src')});
  });

  const ensureAgentSurface = () => {
    if (!agentFrame) return;
    if (!agentFrame.getAttribute('src')) agentFrame.setAttribute('src', agentFrame.dataset.src || 'side-panel/index.html');
  };
  const agentReload = document.getElementById('titan-agent-reload');
  if (agentReload) agentReload.addEventListener('click', () => {
    if (!agentFrame) return;
    agentFallback?.setAttribute('hidden','');
    const src = agentFrame.getAttribute('src') || agentFrame.dataset.src || 'side-panel/index.html';
    agentFrame.setAttribute('src', src);
  });
  agentFrame?.addEventListener('load', () => { agentFallback?.setAttribute('hidden',''); window.titanDiagWrite?.('info','retriever','First-class Agent surface loaded',{surface:'agent'}); });
  const agentCapabilityGrid = document.getElementById('titan-agent-capability-grid');
  let retrieverCapabilityCatalog = null;
  const ensureRetrieverCapabilityCatalog = async () => {
    if (retrieverCapabilityCatalog) return retrieverCapabilityCatalog;
    try {
      const response = await fetch(chrome.runtime.getURL('retriever-capability-catalog.json'));
      if (!response.ok) throw new Error(`Capability catalog HTTP ${response.status}`);
      retrieverCapabilityCatalog = await response.json();
      if (agentCapabilityGrid) {
        agentCapabilityGrid.textContent = '';
        for (const capability of retrieverCapabilityCatalog.capabilities || []) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'agent-capability';
          button.dataset.retrieverCapability = capability.id;
          const strong = document.createElement('strong'); strong.textContent = capability.label;
          const small = document.createElement('small'); small.textContent = `${(capability.helpers || []).length} runtime helper${(capability.helpers || []).length === 1 ? '' : 's'}`;
          button.append(strong, small);
          button.addEventListener('click', () => launchRetrieverCapability(capability));
          agentCapabilityGrid.appendChild(button);
        }
      }
      return retrieverCapabilityCatalog;
    } catch (error) {
      window.titanDiagWrite?.('warn','retriever','Retriever capability catalog unavailable',{error:String(error?.message||error)});
      return null;
    }
  };
  const launchRetrieverCapability = async (capability) => {
    ensureAgentSurface();
    setView('agent');
    const frame = document.getElementById('titan-agent-frame');
    if (!frame) return;
    const requestId = `cap-${capability.id}-${Date.now()}`;
    const dispatch = () => frame.contentWindow?.postMessage({
      type:'TITAN_RETRIEVER_EXECUTE', requestId,
      outcome: capability.prompt,
      displayOutcome: capability.label,
      context:{ source:'titan-agent-capability-catalog', capability_id:capability.id, helper_names:capability.helpers || [] }
    }, '*');
    if (frame.contentWindow && frame.getAttribute('src')) setTimeout(dispatch, 50);
    else frame.addEventListener('load', () => setTimeout(dispatch, 50), {once:true});
    window.titanDiagWrite?.('info','retriever','Retriever capability launched',{capability_id:capability.id,requestId});
  };
  ensureRetrieverCapabilityCatalog();

  // FINISH-004 Pass 3: first-class Retriever task lifecycle UI.
  const agentTaskInput = document.getElementById('titan-agent-task-input');
  const agentTaskRun = document.getElementById('titan-agent-task-run');
  const agentTaskModes = [...document.querySelectorAll('[data-retriever-mode]')];
  let agentTaskMode = 'browse';
  const setAgentTaskMode = mode => {
    if (!['browse','extract','retrieve'].includes(mode)) return;
    agentTaskMode = mode;
    agentTaskModes.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.retrieverMode === mode)));
    if (agentTaskInput) agentTaskInput.placeholder = mode === 'extract' ? 'Describe what structured information to extract…' : mode === 'retrieve' ? 'Describe the information or evidence to retrieve…' : 'Describe the browsing outcome…';
  };
  agentTaskModes.forEach(button => button.addEventListener('click', () => setAgentTaskMode(button.dataset.retrieverMode)));
  const agentTaskCancel = document.getElementById('titan-agent-task-cancel');
  const agentTaskRetry = document.getElementById('titan-agent-task-retry');
  const agentTaskState = document.getElementById('titan-agent-task-state');
  const agentTaskStateLabel = document.getElementById('titan-agent-task-state-label');
  const agentTaskMeta = document.getElementById('titan-agent-task-meta');
  const agentEvidenceList = document.getElementById('titan-agent-evidence-list');
  const agentEvidenceCount = document.getElementById('titan-agent-evidence-count');
  let agentTask = null;
  let agentEvidence = [];
  let agentEvidenceAll = [];

  const renderAgentEvidence = () => {
    const company_id = businessProfile?.company_id || null;
    agentEvidence = agentEvidenceAll.filter(item => item?.company_id === company_id).slice(0,50);
    if (agentEvidenceCount) agentEvidenceCount.textContent = String(agentEvidence.length);
    if (agentEvidenceList) {
      agentEvidenceList.textContent = '';
      for (const item of agentEvidence) {
        const row=document.createElement('div'); row.className='agent-evidence-item';
        const strong=document.createElement('strong'); strong.textContent=`${item.kind} · ${new Date(item.at).toLocaleTimeString()}`;
        const span=document.createElement('span'); span.textContent=item.text || '(no detail)';
        row.append(strong,span); agentEvidenceList.appendChild(row);
      }
    }
  };

  const renderAgentTaskState = (state='ready', label='Ready', meta='No task running') => {
    if (agentTaskState) agentTaskState.dataset.state = state;
    if (agentTaskStateLabel) agentTaskStateLabel.textContent = label;
    if (agentTaskMeta) agentTaskMeta.textContent = meta;
    if (agentTaskCancel) agentTaskCancel.disabled = state !== 'running';
    if (agentTaskRetry) agentTaskRetry.disabled = !agentTask || state === 'running';
  };
  const addAgentEvidence = (kind, text, detail={}) => {
    const company_id = String(detail.company_id || agentTask?.company_id || businessProfile?.company_id || '').trim();
    if (!company_id) return null;
    const entry = { at:Date.now(), kind, text:String(text||'').slice(-1200), task_id:detail.task_id||null, request_id:detail.request_id||agentTask?.requestId||null, company_id, source:detail.source||'retriever' };
    agentEvidenceAll = [entry, ...agentEvidenceAll].slice(0,500);
    renderAgentEvidence();
    chrome.storage.local.set({titanRetrieverTaskEvidence:agentEvidenceAll}).catch(()=>{});
    return entry;
  };
  const executeAgentTask = async (outcome, options={}) => {
    const clean=String(outcome||'').trim();
    if (!clean || !agentFrame) return false;
    ensureAgentSurface(); setView('agent');
    const company_id=businessProfile?.company_id;
    if (!company_id) { renderAgentTaskState('error','Blocked','Canonical company_id unavailable'); return false; }
    const requestId=options.requestId || `retriever-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const mode=options.mode||agentTaskMode||'browse';
    agentTask={requestId,outcome:clean,mode,company_id,startedAt:Date.now(),source:options.source||'agent-task-console'};
    renderAgentTaskState('running',mode === 'extract' ? 'Extracting' : mode === 'retrieve' ? 'Retrieving' : 'Browsing',clean);
    addAgentEvidence(options.retry?'Retry':'Started',clean,{request_id:requestId,mode,company_id,source:agentTask.source});
    const dispatch=()=>agentFrame.contentWindow?.postMessage({type:'TITAN_RETRIEVER_EXECUTE',requestId,outcome:clean,displayOutcome:clean,mode,company_id,source:agentTask.source,context:{company_id,mode,authority:'policy+permissions+autonomy+risk+entitlements',approval:'runtime-governed',return_channel:'titan-agent-task-console'}},'*');
    if (agentFrame.getAttribute('src')) setTimeout(dispatch,60); else agentFrame.addEventListener('load',()=>setTimeout(dispatch,60),{once:true});
    await chrome.storage.local.set({titanRetrieverActiveTask:agentTask}).catch(()=>{});
    window.titanDiagWrite?.('info','retriever-ui','Retriever task dispatched',{requestId,company_id,source:agentTask.source});
    return true;
  };
  agentTaskRun?.addEventListener('click',()=>executeAgentTask(agentTaskInput?.value,'').then(ok=>{if(ok&&agentTaskInput)agentTaskInput.value='';}));
  agentTaskInput?.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();agentTaskRun?.click();}});
  agentTaskCancel?.addEventListener('click',()=>{
    if (!agentTask || !agentFrame) return;
    let cancelControl=null;
    try {
      const doc=agentFrame.contentDocument;
      const visible=node=>{const r=node.getBoundingClientRect();const style=agentFrame.contentWindow.getComputedStyle(node);return r.width>20&&r.height>14&&style.display!=='none'&&style.visibility!=='hidden';};
      cancelControl=[...(doc?.querySelectorAll('button,[role="button"]')||[])].filter(visible).find(node=>/cancel|stop|abort|terminate/i.test(`${node.textContent||''} ${node.getAttribute('aria-label')||''} ${node.getAttribute('title')||''}`));
      if(cancelControl) cancelControl.click(); else doc?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));
    } catch (_) {}
    renderAgentTaskState('cancelled','Cancelled',agentTask.outcome);
    addAgentEvidence('Cancelled',agentTask.outcome,{request_id:agentTask.requestId,company_id:agentTask.company_id,source:'titan-agent-task-console'});
    chrome.storage.local.set({titanRetrieverActiveTask:{...agentTask,state:'cancelled',updatedAt:Date.now()}}).catch(()=>{});
  });
  agentTaskRetry?.addEventListener('click',()=>{if(agentTask) executeAgentTask(agentTask.outcome,{retry:true,source:'agent-task-retry'});});
  agentFrame?.addEventListener('load',()=>{try{agentFrame.contentWindow?.postMessage({type:'TITAN_RETRIEVER_PING',requestId:`agent-load-${Date.now()}`},'*')}catch(_){}});
  window.addEventListener('message', event => {
    if (event.source !== agentFrame?.contentWindow) return;
    const msg=event.data||{};
    if (msg.type==='TITAN_RETRIEVER_READY') { if (!agentTask) renderAgentTaskState('ready','Ready',msg.composerReady?'Retriever task composer ready':'Retriever runtime loading'); return; }
    if (!['TITAN_OUTCOME_ACCEPTED','TITAN_OUTCOME_PROGRESS','TITAN_OUTCOME_RESULT','TITAN_OUTCOME_ERROR','TITAN_OUTCOME_CANCELLED'].includes(msg.type)) return;
    // Fail closed: lifecycle messages must correlate exactly to the active Retriever request.
    // Missing IDs are rejected so stale/replayed frame events cannot mutate current task state.
    if (!agentTask?.requestId || msg.requestId !== agentTask.requestId) return;
    // company_id is the sole canonical company boundary; lifecycle responses must echo it exactly.
    if (!agentTask?.company_id || String(msg.company_id || '').trim() !== agentTask.company_id) return;
    // Once a request reaches a terminal state, reject replayed/late lifecycle events for it.
    if (['complete','error','cancelled'].includes(agentTaskState?.dataset.state || '')) return;
    const text=String(msg.text||msg.message||msg.outcome||agentTask?.outcome||'').trim();
    if (msg.type==='TITAN_OUTCOME_ACCEPTED') { renderAgentTaskState('running','Running',agentTask?.outcome||'Retriever task accepted'); addAgentEvidence('Accepted',text,{request_id:msg.requestId,company_id:agentTask?.company_id,source:msg.source}); return; }
    if (msg.type==='TITAN_OUTCOME_PROGRESS') { renderAgentTaskState('running','Running',text||agentTask?.outcome); addAgentEvidence('Progress',text,{task_id:msg.taskId,request_id:msg.requestId,company_id:agentTask?.company_id,source:msg.source}); return; }
    if (msg.type==='TITAN_OUTCOME_RESULT') { renderAgentTaskState('complete','Complete',text||'Retriever task completed'); addAgentEvidence('Result',text,{task_id:msg.taskId,request_id:msg.requestId,company_id:agentTask?.company_id,source:msg.source}); }
    if (msg.type==='TITAN_OUTCOME_ERROR') { renderAgentTaskState('error','Needs attention',text||'Retriever task failed'); addAgentEvidence('Failure',text,{task_id:msg.taskId,request_id:msg.requestId,company_id:agentTask?.company_id,source:msg.source}); }
    if (msg.type==='TITAN_OUTCOME_CANCELLED') { renderAgentTaskState('cancelled','Cancelled',agentTask?.outcome||'Retriever task cancelled'); addAgentEvidence('Cancelled',text,{request_id:msg.requestId,company_id:agentTask?.company_id,source:msg.source}); }
    chrome.storage.local.set({titanRetrieverActiveTask:{...agentTask,state:agentTaskState?.dataset.state,updatedAt:Date.now(),lastDetail:text}}).catch(()=>{});
  });
  chrome.storage.local.get(['titanRetrieverTaskEvidence','titanRetrieverActiveTask']).then(data=>{
    if(Array.isArray(data.titanRetrieverTaskEvidence)){
      agentEvidenceAll=data.titanRetrieverTaskEvidence.filter(item=>item?.company_id).slice(0,500);
      renderAgentEvidence();
    }
    if(data.titanRetrieverActiveTask?.company_id===businessProfile?.company_id){agentTask=data.titanRetrieverActiveTask;renderAgentTaskState(agentTask.state||'ready',agentTask.state==='complete'?'Complete':agentTask.state==='error'?'Needs attention':agentTask.state==='cancelled'?'Cancelled':'Ready',agentTask.lastDetail||agentTask.outcome||'No task running');}
  }).catch(()=>{});

  tabs.forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));

  const replacements = [
    [/\bMonica\b/g, 'Titan Zero'],
    [/\bRetriever AI\b/g, 'Titan Zero Runtime'],
    [/\bRetriever\b/g, 'Titan Zero Runtime']
  ];
  const brandTextNode = node => {
    if (!node || node.nodeType !== Node.TEXT_NODE || !node.nodeValue?.trim()) return;
    let value = node.nodeValue;
    replacements.forEach(([pattern, replacement]) => { value = value.replace(pattern, replacement); });
    if (value !== node.nodeValue) node.nodeValue = value;
  };
  const brandTree = root => {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = walker.nextNode())) brandTextNode(n);
  };
  brandTree(document.body);
  const observer = new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => {
    if (n.nodeType === Node.TEXT_NODE) brandTextNode(n);
    else if (n.nodeType === Node.ELEMENT_NODE) brandTree(n);
  })));
  const chatView = document.getElementById('titan-chat-view');
  if (chatView) observer.observe(chatView, {childList:true,subtree:true});

  const filterFeed = (item) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'unread') return item.unread && !readIds.has(item.id);
    return item.action === activeFilter;
  };

  const relativeTime = ts => {
    const at = Number(ts) || Date.parse(ts || '') || Date.now();
    const mins = Math.max(0, Math.floor((Date.now() - at) / 60000));
    if (mins < 1) return 'Now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const normalizedMeta = item => {
    const meta = Array.isArray(item.meta) ? [...item.meta] : [];
    if (!meta.length) meta.push(relativeTime(item.at || item.updatedAt || item.createdAt));
    return meta.slice(0,4);
  };

  const renderFeed = () => {
    if (!feedList) return;
    feedList.innerHTML = '';
    const visible = feedItems.filter(filterFeed);
    if (!visible.length) {
      feedList.innerHTML = `<div class="feed-empty"><strong>No ${activeFilter === 'all' ? 'operational activity' : escapeHtml(activeFilter + ' items')} yet</strong>Titan-generated work, outcomes and attention items will appear here as they happen.</div>`;
      return;
    }
    visible.forEach(item => {
      const card = document.createElement('button');
      card.className = `feed-card ${item.tone || 'neutral'} urgency-${item.urgency || (item.tone==='attention'?'urgent':item.tone==='progress'?'important':'normal')} ${(item.unread && !readIds.has(item.id)) ? 'unread' : ''}`;
      card.dataset.id = item.id;
      const meta = normalizedMeta(item);
      card.innerHTML = `<span class="feed-icon">${escapeHtml(item.icon || '→')}</span><span class="feed-copy"><span class="feed-kind">${escapeHtml(item.kind || 'Update')}</span><strong>${escapeHtml(item.title || 'Titan update')}</strong><span>${escapeHtml(item.summary || '')}</span><small>${meta.map(escapeHtml).join(' · ')}</small></span><span class="feed-chevron">›</span>`;
      card.addEventListener('click', () => openDrawer(item));
      feedList.appendChild(card);
    });
  };

  async function persistFeedItem(item) {
    if (!businessProfile?.company_id || !item) return;
    const targetCompanyId = String(item.company_id || businessProfile.company_id).trim();
    if (!isValidCompanyId(targetCompanyId)) {
      window.titanDiagWrite?.('error','business-feed','Rejected feed item without a valid company boundary',{id:item?.id,company_id:targetCompanyId});
      return;
    }
    const normalized = {
      unread: true,
      icon: '→',
      tone: 'neutral',
      kind: 'Update',
      action: 'workflow',
      at: Date.now(),
      ...item,
      company_id: targetCompanyId
    };
    try {
      await businessStateMessage('commit', { company_id: normalized.company_id, domain: 'activity', record: normalized, options: { entity_id: normalized.id, source: 'titan-shell-feed' } });
      feedItems = (await listBusinessState('activity', businessProfile.company_id))
        .sort((a,b)=>(Number(b.at)||0)-(Number(a.at)||0))
        .slice(0,300);
      renderFeed();
      renderBusiness();
    } catch (e) {
      window.titanDiagWrite?.('error','business-feed','Unable to persist feed item',{message:e.message,id:normalized.id});
    }
  }

  const openDrawer = (item) => {
    if (!drawer || !item) return;
    selectedFeedItem = item;
    readIds.add(item.id);
    save({ [STORAGE.feedRead]:[...readIds] });
    renderFeed();
    renderBusiness();
    document.getElementById('titan-drawer-kind').textContent = item.kind || 'Update';
    document.getElementById('titan-drawer-title').textContent = item.title || 'Titan update';
    document.getElementById('titan-drawer-summary').textContent = item.summary || '';
    document.getElementById('titan-drawer-meta').innerHTML = normalizedMeta(item).map(x => `<span>${escapeHtml(x)}</span>`).join('');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden','false');
  };
  const closeDrawer = () => { drawer?.classList.remove('open'); drawer?.setAttribute('aria-hidden','true'); };
  document.getElementById('titan-drawer-close')?.addEventListener('click', closeDrawer);
  document.getElementById('titan-feed-refresh')?.addEventListener('click', refreshOperationalState);
  document.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => {
    activeFilter = btn.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b===btn));
    renderFeed();
  }));

  const updateContextUI = (ctx) => {
    const pill = document.getElementById('titan-active-context');
    const work = document.getElementById('titan-work-context');
    if (!pill || !work) return;
    if (!ctx) {
      pill.hidden = true;
      work.hidden = true;
      if (contextCopy) contextCopy.textContent='Chat, investigate, summarise or act on the current page.';
      return;
    }
    pill.hidden = false;
    pill.querySelector('span').textContent = ctx.title || ctx.url || 'Active context';
    work.hidden = false;
    work.textContent = `Context: ${ctx.title || ctx.url || 'Active context'}`;
    if (contextCopy) contextCopy.textContent = `Context: ${ctx.title || ctx.url || 'Active context'}`;
  };
  const clearContext = async () => { await save({[STORAGE.context]:null}); updateContextUI(null); };
  document.getElementById('titan-clear-context')?.addEventListener('click', clearContext);

  const capturePage = async () => {
    try {
      const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
      if (!tab?.id) throw new Error('No active tab available');
      const [{result}={}] = await chrome.scripting.executeScript({target:{tabId:tab.id}, func:()=>({title:document.title,url:location.href,text:(document.body?.innerText||'').slice(0,12000)})});
      if (!result) throw new Error('Page capture returned no result');
      const ctx = {
        id:`page-${tab.id}`,
        kind:'Page',
        title:result.title || tab.title || 'Current page',
        url:result.url,
        summary:(result.text || '').replace(/\s+/g,' ').trim().slice(0,500),
        action:'page',
        sharedAt:Date.now(),
        company_id: businessProfile?.company_id || null
      };
      await save({[STORAGE.context]:ctx});
      updateContextUI(ctx);
      try { frame?.contentWindow?.postMessage({type:'TITAN_SHARED_CONTEXT',payload:ctx},'*'); } catch (_) {}
      window.titanDiagWrite?.('info','context','Captured active page context',{title:ctx.title,url:ctx.url,company_id:ctx.company_id});
    } catch (e) {
      if (contextCopy) contextCopy.textContent='Could not capture this page.';
      window.titanDiagWrite?.('error','shell','Page capture failed',{message:e.message,stack:e.stack});
    }
  };
  document.getElementById('titan-capture-page')?.addEventListener('click', capturePage);

  const requestOutcome = (outcome, source='shell') => {
    const clean = String(outcome || '').trim();
    if (!clean) return;
    window.dispatchEvent(new CustomEvent('titan:outcome',{detail:{outcome:clean,source}}));
  };

  document.querySelectorAll('#titan-quick-actions [data-prompt]').forEach(btn => btn.addEventListener('click', () => {
    setView('chat');
    requestOutcome(btn.dataset.prompt, 'quick-action');
  }));

  const shareContext = (item) => {
    if (!item) return;
    const titanSharedContext = {
      id:item.id,
      kind:item.kind,
      title:item.title,
      summary:item.summary,
      action:item.action,
      sharedAt:Date.now(),
      company_id: businessProfile?.company_id || null
    };
    save({ [STORAGE.context]:titanSharedContext });
    updateContextUI(titanSharedContext);
    try { frame?.contentWindow?.postMessage({ type:'TITAN_SHARED_CONTEXT', payload:titanSharedContext }, '*'); } catch (_) {}
    window.postMessage({ type:'TITAN_SHARED_CONTEXT', payload:titanSharedContext }, '*');
  };

  document.getElementById('titan-ask-about')?.addEventListener('click', () => {
    if (!selectedFeedItem) return;
    shareContext(selectedFeedItem);
    closeDrawer();
    setView('chat');
  });
  document.getElementById('titan-open-work')?.addEventListener('click', () => {
    if (!selectedFeedItem) return;
    shareContext(selectedFeedItem);
    closeDrawer();
    setView('chat');
  });

  const brandFrame = () => {
    try {
      const doc = frame?.contentDocument;
      if (!doc?.body) return;
      brandTree(doc.body);
      const obs = new MutationObserver(records => records.forEach(r => r.addedNodes.forEach(n => {
        if (n.nodeType === Node.TEXT_NODE) brandTextNode(n);
        else if (n.nodeType === Node.ELEMENT_NODE) brandTree(n);
      })));
      obs.observe(doc.body,{childList:true,subtree:true});
    } catch (e) {
      window.titanDiagWrite?.('warn','retriever-frame','Unable to brand work frame',{message:e.message});
    }
  };

  if (frame) {
    const timer = setTimeout(() => {
      if (workStatus) workStatus.textContent = 'Still loading…';
      if (workFallback) workFallback.hidden=false;
      workFrameState='timeout';
      save({[STORAGE.workState]:'timeout'});
      renderBusiness();
      window.titanDiagWrite?.('warn','retriever-frame','Work frame load timeout');
    }, 5000);
    frame.addEventListener('load', () => {
      clearTimeout(timer);
      if (workStatus) workStatus.textContent = 'Ready';
      if (workFallback) workFallback.hidden=true;
      workFrameState='ready';
      save({[STORAGE.workState]:'ready'});
      renderBusiness();
      window.titanDiagWrite?.('info','retriever-frame','Work frame loaded');
      brandFrame();
      try {
        frame.contentWindow.addEventListener('error',e=>window.titanDiagWrite?.('error','retriever-frame',e.message,{filename:e.filename,line:e.lineno,column:e.colno,stack:e.error?.stack}));
        frame.contentWindow.addEventListener('unhandledrejection',e=>window.titanDiagWrite?.('error','retriever-frame','Unhandled promise rejection',{reason:String(e.reason),stack:e.reason?.stack}));
      } catch (e) {
        window.titanDiagWrite?.('warn','retriever-frame','Could not attach frame error listeners',{message:e.message});
      }
      try { frame.contentWindow.postMessage({type:'TITAN_SHELL_READY',company_id:businessProfile?.company_id || null}, '*'); } catch (_) {}
    });
  }

  const renderBusinessQueue = () => {
    const queue = document.getElementById('titan-business-queue');
    if (!queue) return;
    queue.innerHTML='';
    const items = feedItems.slice(0,8);
    if (!items.length) {
      queue.innerHTML='<div class="business-empty">No Titan activity has been recorded for this company yet. Run an owner command or ask Titan for an outcome to start building the queue.</div>';
      return;
    }
    items.forEach(item => {
      const row=document.createElement('button');
      row.className='business-queue-item';
      row.innerHTML=`<strong>${escapeHtml(item.title || 'Titan update')}</strong><span>${escapeHtml(item.summary || '')}</span><small>${escapeHtml(relativeTime(item.at || item.updatedAt))}</small>`;
      row.addEventListener('click',()=>openDrawer(item));
      queue.appendChild(row);
    });
  };

  const renderBusiness = () => {
    if (!businessProfile) return;
    const currentOutcomes = outcomeHistory.filter(x => x?.company_id === businessProfile.company_id);
    const open = currentOutcomes.filter(x => ['submitted','working'].includes(x?.state)).length;
    const attention = currentOutcomes.filter(x => ['attention','failed'].includes(x?.state)).length;
    const unread = feedItems.filter(x => x?.unread && !readIds.has(x.id)).length;
    const setText = (id,value) => { const el=document.getElementById(id); if(el) el.textContent=String(value); };
    setText('titan-kpi-open', open);
    setText('titan-kpi-attention', attention);
    setText('titan-kpi-unread', unread);
    setText('titan-kpi-work', workFrameState === 'ready' ? 'Retriever Ready' : workFrameState === 'timeout' ? 'Attention' : 'Starting');
    setText('titan-business-title', businessProfile.name);
    setText('titan-business-boundary', `company_id: ${businessProfile.company_id}`);
    const nameInput=document.getElementById('titan-company-name');
    const idInput=document.getElementById('titan-company-id');
    if (nameInput && document.activeElement !== nameInput) nameInput.value=businessProfile.name;
    if (idInput && document.activeElement !== idInput) idInput.value=businessProfile.company_id;
    renderBusinessQueue();
  };

  async function refreshOperationalState() {
    try {
      const data = await chrome.storage.local.get([
        STORAGE.view, STORAGE.legacyView, STORAGE.context, STORAGE.feedRead,
        STORAGE.businessProfile, STORAGE.workState, STORAGE.aiTarget
      ]);
      businessProfile = await ensureBusinessProfile(data);
      try {
        await businessStateMessage('migrateLegacyStorage', { company_id: businessProfile.company_id, options: { include_history: true } });
      } catch (migrationError) {
        window.titanDiagWrite?.('warn','business','Legacy business-state migration did not complete',{message:migrationError.message,company_id:businessProfile.company_id});
      }
      feedItems = (await listBusinessState('activity', businessProfile.company_id))
        .sort((a,b)=>(Number(b.at)||0)-(Number(a.at)||0));
      feedItems = await seedDemoOperationalDataIfEmpty(businessProfile, feedItems);
      feedItems = feedItems.sort((a,b)=>(Number(b.at)||0)-(Number(a.at)||0)).slice(0,300);
      outcomeHistory = await listBusinessState('outcome', businessProfile.company_id);
      readIds = new Set(Array.isArray(data[STORAGE.feedRead]) ? data[STORAGE.feedRead] : []);
      workFrameState = data[STORAGE.workState] || workFrameState || 'unknown';
      const storedContext = data[STORAGE.context] || null;
      const activeContext = storedContext && (!storedContext.company_id || storedContext.company_id === businessProfile.company_id) ? storedContext : null;
      updateContextUI(activeContext);
      renderFeed();
      renderBusiness();
      const storedRequestedView = data[STORAGE.view] || data[STORAGE.legacyView];
      const requestedView = launchView || storedRequestedView;
      if (requestedView && views[requestedView]) setView(requestedView);
      const requestedAiTarget = launchAiTarget || data[STORAGE.aiTarget];
      if (requestedView === 'ai' && requestedAiTarget) {
        openAiWorkspaceTarget(requestedAiTarget);
        if (data[STORAGE.aiTarget]) await chrome.storage.local.remove(STORAGE.aiTarget);
      }
    } catch (e) {
      window.titanDiagWrite?.('error','business','Unable to refresh operational state',{message:e.message,stack:e.stack});
    }
  }

  document.querySelectorAll('[data-business-command]').forEach(btn => btn.addEventListener('click', () => {
    setView('chat');
    requestOutcome(btn.dataset.businessCommand, 'business-command');
  }));
  document.querySelector('[data-titan-workforce-jump]')?.addEventListener('click',()=>setView('workforce'));
  document.getElementById('titan-business-refresh')?.addEventListener('click', refreshOperationalState);
  document.getElementById('titan-open-feed')?.addEventListener('click',()=>setView('feed'));
  document.getElementById('titan-save-business-profile')?.addEventListener('click', async () => {
    const name = String(document.getElementById('titan-company-name')?.value || '').trim();
    const company_id = String(document.getElementById('titan-company-id')?.value || '').trim();
    const status = document.getElementById('titan-business-profile-status');
    if (!name) {
      if (status) { status.textContent='Business name is required.'; status.className='error'; }
      return;
    }
    if (!isValidCompanyId(company_id)) {
      if (status) { status.textContent='Company ID: 2–128 letters, numbers, . _ : -'; status.className='error'; }
      return;
    }
    const previous = businessProfile?.company_id;
    const changedBoundary = !!previous && previous !== company_id;
    if (changedBoundary && agentTask?.company_id === previous) {
      // Detach old-company task state locally; do not issue a cross-company cancel/execution command.
      agentTask = null;
      renderAgentTaskState('ready','Ready','Company changed; previous task detached');
      await chrome.storage.local.remove('titanRetrieverActiveTask').catch(()=>{});
    }
    businessProfile = normalizeBusinessProfile({name,company_id,updatedAt:Date.now()});
    await save({[STORAGE.businessProfile]:businessProfile});
    renderAgentEvidence();
    if (changedBoundary) {
      window.dispatchEvent(new CustomEvent('titan:company-boundary-changed',{detail:{previous_company_id:previous,company_id}}));
      // Flat Retriever projection keys describe the active company only. Never carry them across a boundary switch.
      await chrome.storage.local.remove([
        'titanConversationRetrieverHandoff',
        'titanRetrieverBridgeState',
        'titanConversationRetrieverLifecycle',
        'titanConversationRetrieverResult'
      ]).catch(()=>{});
    }
    if (status) { status.textContent='Saved'; status.className='ok'; setTimeout(()=>{status.textContent='';status.className='';},1600); }
    window.titanDiagWrite?.('info','business','Business identity saved',{company_id,changedBoundary});
    await refreshOperationalState();
  });

  window.addEventListener('titan:feed', event => persistFeedItem(event.detail));
  window.addEventListener('titan:business-state-changed', refreshOperationalState);

  const runDiagnostics = async () => {
    const out=document.getElementById('titan-diagnostics-results');
    if (!out) return;
    const rows=[];
    rows.push(['Shell','OK']);
    rows.push(['Business',businessProfile ? businessProfile.name : 'Missing']);
    rows.push(['Company boundary',businessProfile?.company_id || 'Missing']);
    rows.push(['Titan chat root',document.getElementById('root')?'Present':'Missing']);
    rows.push(['Titan Work frame',frame?'Present':'Missing']);
    try { const perms=await chrome.permissions.getAll(); rows.push(['Permissions',`${(perms.permissions||[]).length} granted`]); rows.push(['Hosts',`${(perms.origins||[]).length} origins`]); } catch (_) { rows.push(['Permissions','Unavailable']); }
    try { rows.push(['Storage',chrome.storage?.local?'Available':'Missing']); } catch (_) { rows.push(['Storage','Unavailable']); }
    try { rows.push(['Work document',frame?.contentDocument?.readyState || 'Unknown']); } catch (_) { rows.push(['Work document','Blocked']); }
    out.innerHTML=rows.map(([a,b])=>`<div class="diag-row"><span>${escapeHtml(a)}</span><strong>${escapeHtml(b)}</strong></div>`).join('');
  };

  document.getElementById('titan-modules-open')?.addEventListener('click',()=>window.titanDiagWrite?.('info','shell','Modules page opened'));
  document.getElementById('titan-diagnostics-open')?.addEventListener('click',event=>{
    event.preventDefault();
    window.titanDiagWrite?.('info','shell','Diagnostics page opened');
    window.open(chrome.runtime.getURL('diagnostics.html'),'_blank');
  });
  document.getElementById('titan-diagnostics-close')?.addEventListener('click',()=>{diagnosticsPanel?.classList.remove('open');diagnosticsPanel?.setAttribute('aria-hidden','true');});
  document.getElementById('titan-reset-workspace')?.addEventListener('click', async()=>{
    try {
      if (businessProfile?.company_id) {
        await businessStateMessage('clear', { company_id: businessProfile.company_id, domain: 'activity', options: { source: 'titan-shell-reset' } });
        await businessStateMessage('clear', { company_id: businessProfile.company_id, domain: 'outcome', options: { source: 'titan-shell-reset' } });
      }
      await chrome.storage.local.remove([STORAGE.context,STORAGE.feedRead,STORAGE.view,STORAGE.legacyView]);
    } catch (_) {}
    readIds.clear(); feedItems=[]; outcomeHistory=[];
    updateContextUI(null); renderFeed(); renderBusiness(); setView('business');
    window.titanDiagWrite?.('info','business','Cleared local operational activity',{company_id:businessProfile?.company_id});
  });
  document.getElementById('titan-work-reload')?.addEventListener('click',()=>{ if(frame){workFallback.hidden=true; if(workStatus) workStatus.textContent='Reloading…'; frame.src=frame.src;} });

  const openWorkspaceFullScreen = view => { const base=chrome.runtime.getURL('sidePanel.html'); const query=new URLSearchParams({view:String(view||'chat'),fullscreen:'1'}); return chrome.tabs?.create?.({url:`${base}?${query.toString()}`}); };
  document.getElementById('titan-business-fullscreen')?.addEventListener('click',()=>openWorkspaceFullScreen('business'));
  document.getElementById('titan-workforce-fullscreen')?.addEventListener('click',()=>openWorkspaceFullScreen('workforce'));
  const menuToggle=document.getElementById('titan-menu-toggle');
  const menu=document.getElementById('titan-hamburger-menu');
  const closeMenu=()=>{if(menu){menu.hidden=true;menuToggle?.setAttribute('aria-expanded','false')}};
  menuToggle?.addEventListener('click',event=>{event.stopPropagation();if(!menu)return;menu.hidden=!menu.hidden;menuToggle.setAttribute('aria-expanded',String(!menu.hidden));});
  document.addEventListener('click',event=>{if(menu&&!menu.hidden&&!menu.contains(event.target)&&event.target!==menuToggle)closeMenu();});
  document.querySelectorAll('[data-menu-view]').forEach(button=>button.addEventListener('click',()=>{setView(button.dataset.menuView);closeMenu();}));
  if(launchFullscreen) document.body.classList.add('titan-fullscreen-workspace');
  if(launchView) setTimeout(()=>setView(launchView),0);

  document.addEventListener('keydown', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === '1') { event.preventDefault(); setView('chat'); }
    if (key === '2') { event.preventDefault(); setView('business'); }
    if (key === '3') { event.preventDefault(); setView('feed'); }
    if (key === '4') { event.preventDefault(); setView('workforce'); }
    if (key === '5') { event.preventDefault(); setView('work'); }
    if (key === '6') { event.preventDefault(); setView('ai'); }
    if (key === 'k') { event.preventDefault(); setView('chat'); }
  });

  const renderWorkforce = async () => {
    await window.TitanWorkforceVerticals?.ready;
    const grid=document.getElementById('titan-workforce-grid');
    if(!grid||!window.TitanWorkforce) return;
    const verticalSelect=document.getElementById('titan-service-vertical');
    const count=document.getElementById('titan-service-roster-count');
    const active=document.getElementById('titan-workforce-active');
    let serviceVertical=await window.TitanClientWorkforce?.getVertical?.()||'cleaning';
    let preferred=await window.TitanWorkforce.getPreferredWorker();
    if(verticalSelect&&window.TitanClientWorkforce){
      verticalSelect.innerHTML=Object.entries(window.TitanClientWorkforce.verticals||{}).map(([id,v])=>`<option value="${escapeHtml(id)}">${escapeHtml(v.icon||'•')} ${escapeHtml(v.label||v.name||id)}</option>`).join('');
      verticalSelect.value=serviceVertical;
      if(!verticalSelect.dataset.titanBound){verticalSelect.dataset.titanBound='1';verticalSelect.addEventListener('change',async()=>{serviceVertical=await window.TitanClientWorkforce.setVertical(verticalSelect.value);preferred=null;try{await chrome.storage.local.remove(['titanPreferredWorker'])}catch(_){}paint();});}
    }
    const cardFor=(worker,kind)=>{
      const card=document.createElement('button');card.className=`worker-card ${preferred===worker.id?'active':''}`;card.dataset.workerId=worker.id;card.dataset.workerKind=kind;
      const display=worker.displayName||worker.name||worker.id;const caps=(worker.capabilities||[]).slice(0,5);
      card.innerHTML=`<span class="worker-icon">${escapeHtml(worker.icon||'AI')}</span><span class="worker-copy"><strong>${escapeHtml(display)}</strong><small>${escapeHtml(worker.department||worker.vertical||'Workforce')} · ${escapeHtml(worker.autonomy||'assist')}${worker.riskCeiling?' · risk '+escapeHtml(worker.riskCeiling):''}</small><span>${escapeHtml(worker.description||worker.purpose||'')}</span></span><span class="worker-badges">${caps.map(c=>`<em>${escapeHtml(c)}</em>`).join('')}</span>`;
      card.addEventListener('click',async()=>{preferred=worker.id;await window.TitanWorkforce.setPreferredWorker(worker.id);if(active?.querySelector('span'))active.querySelector('span').textContent=`${display} is preferred for the next matching outcome.`;paint();setView('chat');});return card;
    };
    const paint=()=>{grid.innerHTML='';const roster=window.TitanClientWorkforce?.operationalRoster?.(serviceVertical,'SOLO')||[];if(count)count.textContent=`${roster.length} operational workers · ${window.TitanClientWorkforce?.totalRoles||0} master roles`;if(roster.length){const h=document.createElement('div');h.className='workforce-section-title';h.textContent=`${window.TitanClientWorkforce?.verticals?.[serviceVertical]?.label||'Service'} operational crew`;grid.appendChild(h);roster.forEach(worker=>grid.appendChild(cardFor(worker,'operational')));}const sh=document.createElement('div');sh.className='workforce-section-title';sh.textContent='Shared capability specialists';grid.appendChild(sh);(window.TitanWorkforce.workers||[]).forEach(worker=>grid.appendChild(cardFor(worker,'shared')));};
    const prefWorker=preferred&&window.TitanWorkforce.getWorkerById?.(preferred);if(prefWorker&&active?.querySelector('span'))active.querySelector('span').textContent=`${prefWorker.displayName||prefWorker.name} is preferred for the next matching outcome.`;
    const auto=document.getElementById('titan-workforce-auto');if(auto&&!auto.dataset.titanBound){auto.dataset.titanBound='1';auto.addEventListener('click',async()=>{preferred=null;try{await chrome.storage.local.remove(['titanPreferredWorker'])}catch(_){}if(active?.querySelector('span'))active.querySelector('span').textContent='Auto-routing is active. Titan selects the best operational worker or shared specialist for each outcome.';paint();});}
    paint();
  };

  refreshOperationalState().then(()=>runDiagnostics()).catch(()=>{});
  renderFeed();
})();

/* Titan Zero direct chat/business -> Titan Work outcome execution bridge */
(() => {
  const frame = document.getElementById('titan-work-frame');
  const agentFrame = document.getElementById('titan-agent-frame');
  const agentFallback = document.getElementById('titan-agent-fallback');
  const root = document.getElementById('root');
  const mode = document.getElementById('titan-outcome-mode');
  const toggle = document.getElementById('titan-outcome-toggle');
  const status = document.getElementById('titan-outcome-status');
  let outcomeMode = true;
  let progressObserver = null;
  let progressTimer = null;
  let lastOutcome = '';
  let lastProgressText = '';
  let lastWorker = null;
  let activeOperationId = '';
  let activeCompanyId = '';
  const WORK_READY_TIMEOUT_MS = 5000;

  const escapeHtml = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 40 && r.height > 18 && style.display !== 'none' && style.visibility !== 'hidden';
  };

  const setOutcomeStatus = (text, state='') => {
    if (!status) return;
    status.textContent = text;
    status.className = `outcome-status ${state}`.trim();
    try { chrome.storage.local.set({titanOutcomeBridgeStatus:{text,state,at:Date.now(),operation_id:activeOperationId,company_id:activeCompanyId}}); } catch (_) {}
    if(state==='error') window.titanDiagWrite?.('error','outcome-bridge',text,{operation_id:activeOperationId,company_id:activeCompanyId});
    else window.titanDiagWrite?.('info','outcome-bridge',text,{state,operation_id:activeOperationId,company_id:activeCompanyId});
  };

  async function buildBusinessEnvelope(outcome, source='chat', operation_id='') {
    const data = await chrome.storage.local.get(['titanBusinessProfile','titanSharedContext']);
    const profile = data.titanBusinessProfile || {};
    const company_id = String(profile.company_id || '').trim();
    if (!company_id) throw new Error('Titan Zero business company_id is missing');
    const context = data.titanSharedContext;
    const validContext = context && (!context.company_id || context.company_id === company_id) ? context : null;
    const correlation_id = operation_id || `outcome-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const handoff = {
      schema: 'titan-conversation-retriever-handoff/v1',
      operation_id: correlation_id,
      correlation_id,
      idempotency_key: correlation_id,
      company_id,
      source: {
        surface: 'zero',
        channel: String(source || 'chat'),
        entrypoint: 'sidePanel.html',
        conversation_surface: 'root'
      },
      context: {
        company_id,
        title: validContext?.title ? String(validContext.title).slice(0,200) : null,
        url: validContext?.url ? String(validContext.url).slice(0,500) : null,
        summary: validContext?.summary ? String(validContext.summary).replace(/\s+/g,' ').slice(0,500) : null,
        captured_at: Number(validContext?.at || validContext?.capturedAt || 0) || null,
        provenance: validContext ? 'titanSharedContext' : 'none'
      },
      approval: {
        mode: 'policy-governed',
        state: 'not_granted_by_handoff',
        grants_authority: false
      },
      authority: {
        grants_execution_authority: false,
        evaluator: 'downstream Titan capability/policy/autonomy/risk/entitlement controls'
      },
      return_channel: {
        target: 'titan-conversation',
        transport: 'window.postMessage',
        event: 'titan:conversation-execution-result'
      }
    };
    const lines = [
      'Titan Zero business execution context:',
      `company_id: ${company_id}`,
      `operation_id: ${correlation_id}`,
      `business: ${String(profile.name || 'My Business').slice(0,120)}`,
      `request_source: ${source}`,
      'authority: policy-governed downstream; this handoff grants no execution authority'
    ];
    if (validContext) {
      if (validContext.title) lines.push(`active_context_title: ${String(validContext.title).slice(0,200)}`);
      if (validContext.url) lines.push(`active_context_url: ${String(validContext.url).slice(0,500)}`);
      if (validContext.summary) lines.push(`active_context_summary: ${String(validContext.summary).replace(/\s+/g,' ').slice(0,500)}`);
    }
    lines.push('', 'Requested outcome:', String(outcome).trim());
    return { text:lines.join('\n'), company_id, business_name:profile.name || 'My Business', handoff };
  }

  async function persistOutcome(entry) {
    try {
      const company_id = String(entry?.company_id || businessProfile?.company_id || '').trim();
      const operation_id = String(entry?.operation_id || entry?.outcome_id || entry?.id || '').trim();
      if (!company_id || !operation_id) throw new Error('Outcome requires company_id and operation_id');
      const canonical = { ...entry, company_id, operation_id, updatedAt: Number(entry?.updatedAt) || Date.now() };
      await businessStateMessage('commit', { company_id, domain: 'outcome', record: canonical, options: { entity_id: operation_id, source: 'titan-shell-outcome' } });
      outcomeHistory = (await listBusinessState('outcome', businessProfile?.company_id || company_id)).slice(0,200);
      window.dispatchEvent(new CustomEvent('titan:business-state-changed'));
    } catch (e) {
      window.titanDiagWrite?.('error','outcome-history','Unable to persist outcome',{message:e.message,operation_id:entry?.operation_id});
    }
  }

  const addAgentFeedItem = (outcome, state='started', detail='', operation_id=activeOperationId, company_id=activeCompanyId) => {
    const complete = state === 'complete';
    const failed = state === 'failed' || state === 'attention';
    window.dispatchEvent(new CustomEvent('titan:feed',{detail:{
      id:`agent-${operation_id}`,
      operation_id,
      company_id,
      unread:true,
      kind:'Agent outcome',
      icon:complete ? '✓' : failed ? '!' : '↻',
      tone:complete ? 'insight' : failed ? 'attention' : 'progress',
      title:outcome,
      summary:detail || (state === 'started' ? 'Titan Work is executing this outcome.' : state),
      meta:['Now','Titan Work',state],
      action:'workflow',
      state,
      at:Date.now()
    }}));
  };

  const pendingOutcomeRequests = new Map();
  window.addEventListener('titan:company-boundary-changed', event => {
    const previous = String(event?.detail?.previous_company_id || '').trim();
    const current = String(event?.detail?.company_id || '').trim();
    if (!previous || !current || previous === current || activeCompanyId !== previous) return;
    const requestId = activeOperationId;
    const pending = requestId ? pendingOutcomeRequests.get(requestId) : null;
    if (pending) {
      pendingOutcomeRequests.delete(requestId);
      pending.reject(new Error('Company boundary changed before Titan Work acknowledgement.'));
    }
    window.titanDiagWrite?.('warn','outcome-bridge','Detached active outcome after company boundary change',{operation_id:requestId,previous_company_id:previous,company_id:current});
    activeOperationId='';
    activeCompanyId='';
    lastOutcome='';
    lastProgressText='';
    lastWorker=null;
    setOutcomeStatus('Ready for an outcome');
  });
  let workBridgeReady = false;

  const waitForWorkBridge = async (timeoutMs=7000) => {
    if (!frame?.contentWindow) throw new Error('Titan Work surface is not available.');
    if (workBridgeReady) return true;
    const started=Date.now();
    while (Date.now()-started < timeoutMs) {
      const requestId=`bridge-ping-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
      try { frame.contentWindow.postMessage({type:'TITAN_RETRIEVER_PING',requestId},'*'); } catch (_) {}
      if (workBridgeReady) return true;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw new Error(`Titan Work bridge not ready after ${timeoutMs}ms`);
  };

  async function resolveOutcomeThroughModules(outcome, company_id) {
    try {
      const response = await chrome.runtime.sendMessage({type:'TITAN_MODULES',action:'resolveIntent',text:String(outcome||''),company_id:company_id||null});
      if (!response?.ok || !response.match) return {text:String(outcome||''), match:null};
      window.titanDiagWrite?.('info','module-router','Outcome matched module intent',{moduleId:response.match.moduleId,intent:response.match.id,route:response.match.route,company_id:company_id||null});
      return {text:response.text||String(outcome||''), match:response.match};
    } catch (error) {
      window.titanDiagWrite?.('warn','module-router','Module intent resolution unavailable',{message:error.message});
      return {text:String(outcome||''), match:null};
    }
  }


  async function resolveCapabilityRoute(outcome, company_id, context=null) {
    try {
      const response = await chrome.runtime.sendMessage({
        type:'TITAN_MODULES', action:'routeIntentToCapabilities', text:String(outcome||''), company_id,
        preferred_kinds:['action','query','workflow','worker','tool','service'], context:context||{company_id}
      });
      if (!response?.ok || !response?.route) throw new Error(response?.error || 'Capability router returned no route');
      return response.route;
    } catch (error) {
      window.titanDiagWrite?.('warn','capability-routing','Deterministic capability router unavailable; continuing with existing module/workforce routing',{message:error?.message,company_id});
      return {company_id,selected:null,candidates:[],confidence:0,requires_model:true,reason:'router_unavailable',execution_authority_granted:false,authority_rule:'routing_selects_candidates_but_never_grants_execution_authority'};
    }
  }


  let settingsRegistryCache = null;

  async function loadSettingsControlPlane() {
    const [{ executeSettingsAction }, { createChromeSettingsAdapter }] = await Promise.all([
      import(chrome.runtime.getURL('titan-settings/control-plane/settings-action-bridge.js')),
      import(chrome.runtime.getURL('titan-settings/control-plane/settings-storage-adapter.js'))
    ]);
    if (!settingsRegistryCache) {
      const response = await fetch(chrome.runtime.getURL('titan-settings/control-plane/settings-registry.json'));
      if (!response.ok) throw new Error(`Settings registry unavailable (${response.status})`);
      settingsRegistryCache = await response.json();
    }
    return { executeSettingsAction, createChromeSettingsAdapter, registry: settingsRegistryCache };
  }

  async function settingsDeviceId() {
    const key='titanSettingsDeviceId';
    const data=await chrome.storage.local.get([key]);
    let value=String(data?.[key]||'').trim();
    if (!value) {
      value=`device-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2,10)}`}`;
      await chrome.storage.local.set({[key]:value});
    }
    return value;
  }

  const displaySettingValue = value => {
    if (value === '[redacted-sensitive-setting]') return value;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  };

  async function tryHandleSettingsRequest(outcome, company_id, capabilityRoute, operation_id, source='chat') {
    const capabilityId=String(capabilityRoute?.selected?.id||'');
    if (!['settings.change','settings.read','settings.list'].includes(capabilityId)) return {handled:false};

    const {executeSettingsAction,createChromeSettingsAdapter,registry}=await loadSettingsControlPlane();
    const device_id=await settingsDeviceId();
    const context={
      company_id,
      actor_id:'user:interactive-zero',
      user_id:'user:interactive-zero',
      device_id,
      session_id:operation_id,
      operation_id,
      request_id:operation_id,
      surface:'zero',
      channel:String(source||'chat')
    };
    const adapter=createChromeSettingsAdapter(chrome,{active_company_id:company_id});
    const authorize=async ({proposal}) => {
      const question=`Allow Titan Zero to change ${proposal.setting_key} from ${displaySettingValue(proposal.old_value)} to ${displaySettingValue(proposal.new_value)}?`;
      const allowed=typeof window.confirm==='function' ? window.confirm(question) : false;
      return {allowed,reason:allowed?'interactive-user-confirmed':'interactive-user-declined'};
    };
    const result=await executeSettingsAction({text:String(outcome||''),registry,context,adapter,authorize});
    let text='';
    let state='complete';
    if (result.status==='applied') {
      text=`Setting updated: ${result.setting_key} is now ${displaySettingValue(result.new_value)}.`;
    } else if (result.status==='read') {
      if (Array.isArray(result.settings)) text=`I can manage ${result.settings.length} registered settings through Titan Zero.`;
      else text=`${result.setting_key} is ${displaySettingValue(result.value)}.`;
    } else if (result.status==='not_applied') {
      state='attention';
      text=`I understood the Settings change, but it was not applied (${result.reason||result.authorization?.reason||'approval required'}).`;
    } else if (result.status==='clarification_required') {
      state='attention';
      text='I need a more specific Settings change before I can safely apply anything.';
    } else {
      state='attention';
      text=`Settings change could not be verified (${result.status||'unknown status'}).`;
    }

    await persistOutcome({operation_id,outcome:String(outcome||''),source,state,detail:text,company_id,completedAt:Date.now(),capabilityRoute:capabilityRoute?.selected?.registry_id||null});
    addAgentFeedItem(String(outcome||''),state,text,operation_id,company_id);
    renderProgressInChat(text,true);
    setOutcomeStatus(state==='complete'?'Setting updated':'Setting needs attention',state==='complete'?'complete':'error');
    window.titanDiagWrite?.(state==='complete'?'info':'warn','settings-ai-bridge','Titan Zero handled Settings request',{operation_id,company_id,capability_id:capabilityId,status:result.status,setting_key:result.setting_key||null,verified:result.verified===true,grants_authority:false});
    return {handled:true,result};
  }


  const RETRIEVER_ROUTE_RULES = [
    ['schedules', /\b(schedule|scheduled|appointment|booking|calendar|later|recurring)\b/i],
    ['triggers', /\b(trigger|when |whenever|event-driven|condition|watch for)\b/i],
    ['pdf', /\bpdf|form fill|fill form\b/i],
    ['sheets', /\b(sheet|spreadsheet|worksheet|row|column|cell|csv)\b/i],
    ['docs_slides_web', /\b(doc|document|slides?|presentation|webpage|website|landing page)\b/i],
    ['crawl_extract', /\b(crawl|extract|scrape|harvest|parse page|collect from pages?)\b/i],
    ['browser_actions', /\b(browser|click|open tab|close tab|page action|navigate|current page|tabs?)\b/i],
    ['structured_data', /\b(search|research|enrich|structured data|network data|normalize|discover data)\b/i],
    ['custom_tools', /\b(custom tool|create tool|skill|reusable tool|edit skill|save skill)\b/i],
    ['multi_tool', /./]
  ];

  function chooseRetrieverRoute(outcome, capabilityRoute=null) {
    const catalog = retrieverCapabilityCatalog?.capabilities || [];
    if (!catalog.length) return {capability_id:null,label:null,helpers:[],reason:'catalog_unavailable',execution_authority_granted:false};
    const selected = capabilityRoute?.selected || null;
    const capabilityText = [String(outcome||''),selected?.title,selected?.id,selected?.kind,selected?.module_id,...(selected?.capabilities||[])].filter(Boolean).join(' ');
    let id='multi_tool';
    for (const [candidate,pattern] of RETRIEVER_ROUTE_RULES) { if (pattern.test(capabilityText)) { id=candidate; break; } }
    const match = catalog.find(item=>item.id===id) || catalog.find(item=>item.id==='multi_tool') || catalog[0];
    return {
      capability_id:match?.id||null,
      label:match?.label||null,
      helpers:Array.isArray(match?.helpers)?match.helpers:[],
      prompt:match?.prompt||null,
      reason:selected?.registry_id ? 'intent_capability_plus_retriever_family' : 'conversation_text_retriever_family',
      source_capability_registry_id:selected?.registry_id||null,
      execution_authority_granted:false,
      authority_rule:'route_selection_never_grants_execution_authority'
    };
  }

  function withRetrieverRoutePrompt(executionPrompt, retrieverRoute) {
    if (!retrieverRoute?.capability_id) return executionPrompt;
    const helperText=(retrieverRoute.helpers||[]).join(', ');
    return [
      `Titan Retriever route: ${retrieverRoute.label||retrieverRoute.capability_id} (${retrieverRoute.capability_id})`,
      helperText ? `Retained helper family: ${helperText}` : '',
      'Routing is advisory only. Re-evaluate permissions, approvals, autonomy, risk and entitlements before any effect.',
      '',
      executionPrompt
    ].filter(Boolean).join('\n');
  }

  async function publishConversationRetrieverLifecycle(state, detail={}) {
    const operation_id=String(detail.operation_id||'').trim();
    const company_id=String(detail.company_id||'').trim();
    // Lifecycle publication is operation-bound and company-bound. Never infer authority/boundary
    // from mutable ambient active state when the caller omitted explicit identifiers.
    if (!operation_id || !company_id) {
      window.titanDiagWrite?.('warn','outcome-bridge','Rejected boundary-less Retriever lifecycle publication',{state,operation_id:operation_id||null,company_id:company_id||null});
      return null;
    }
    const payload={
      schema:'titan-conversation-retriever-lifecycle/v1',
      operation_id,
      correlation_id:String(detail.correlation_id||operation_id),
      idempotency_key:String(detail.idempotency_key||operation_id),
      company_id,
      state,
      text:String(detail.text||''),
      task_id:detail.task_id||null,
      retriever_route:detail.retriever_route||null,
      source:detail.source||'titan-zero',
      at:Date.now()
    };
    try { await chrome.storage.local.set({titanConversationRetrieverLifecycle:payload}); } catch(_) {}
    window.dispatchEvent(new CustomEvent('titan:conversation-retriever-lifecycle',{detail:payload}));
    window.postMessage({type:'TITAN_CONVERSATION_RETRIEVER_LIFECYCLE',payload},'*');
    return payload;
  }

  async function dispatchOutcomeToWork(outcome, source='chat') {
    const clean = String(outcome||'').trim();
    if (!clean) return false;

    // New submissions supersede only local correlation/ack state. They do not grant cancel/execute authority.
    const supersededOperationId = activeOperationId;
    if (supersededOperationId) {
      const supersededPending = pendingOutcomeRequests.get(supersededOperationId);
      if (supersededPending) {
        pendingOutcomeRequests.delete(supersededOperationId);
        supersededPending.reject(new Error('Outcome superseded by a newer request.'));
      }
    }

    const operationId = `outcome-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    let operationCompanyId = '';
    let operationWorker = null;

    lastOutcome = clean;
    activeOperationId = operationId;
    activeCompanyId = '';
    lastProgressText='';
    setOutcomeStatus('Preparing business context…','working');
    try {
      const baseEnvelope = await buildBusinessEnvelope(clean, source, operationId);
      if (activeOperationId !== operationId) return false;
      operationCompanyId = baseEnvelope.company_id;
      activeCompanyId = operationCompanyId;

      const moduleResolution = await resolveOutcomeThroughModules(clean, operationCompanyId);
      if (activeOperationId !== operationId) return false;
      const capabilityRoute = await resolveCapabilityRoute(clean, operationCompanyId, baseEnvelope.handoff?.context || {company_id:operationCompanyId});
      if (activeOperationId !== operationId) return false;
      const settingsHandled = await tryHandleSettingsRequest(clean, operationCompanyId, capabilityRoute, operationId, source);
      if (settingsHandled.handled) {
        if (activeOperationId === operationId) activeOperationId='';
        if (activeCompanyId === operationCompanyId) activeCompanyId='';
        return settingsHandled.result?.status === 'applied' || settingsHandled.result?.status === 'read';
      }
      const retrieverRoute = chooseRetrieverRoute(clean, capabilityRoute);
      const routedOutcome = String(moduleResolution.text || clean).trim();
      const envelope = routedOutcome === clean ? baseEnvelope : await buildBusinessEnvelope(routedOutcome, source, operationId);
      if (activeOperationId !== operationId) return false;

      await window.TitanWorkforceVerticals?.ready;
      if (activeOperationId !== operationId) return false;
      let serviceVertical='general_field_services';try{serviceVertical=(await window.TitanClientWorkforce?.getVertical?.())||serviceVertical}catch(_){}
      if (activeOperationId !== operationId) return false;
      let preferred=null;try{preferred=await window.TitanWorkforce?.getPreferredWorker?.()}catch(_){}
      if (activeOperationId !== operationId) return false;

      operationWorker=window.TitanWorkforce?.route?.(clean,preferred,{vertical:serviceVertical,businessTier:'SOLO'})||null;
      lastWorker=operationWorker;
      const workerPrompt=operationWorker&&window.TitanWorkforce?.executionPrompt?window.TitanWorkforce.executionPrompt(operationWorker,envelope.text):envelope.text;
      const executionPrompt=withRetrieverRoutePrompt(workerPrompt,retrieverRoute);

      await persistOutcome({operation_id:operationId,outcome:clean,source,state:'submitted',submittedAt:Date.now(),company_id:operationCompanyId,module:moduleResolution.match?.moduleId||null,moduleIntent:moduleResolution.match?.id||null,workerId:operationWorker?.id||null,workerName:operationWorker?.displayName||operationWorker?.name||null,vertical:serviceVertical,capabilityRoute:capabilityRoute?.selected?.registry_id||null,capabilityRouteConfidence:capabilityRoute?.confidence??0,capabilityRouteRequiresModel:capabilityRoute?.requires_model===true,retrieverRoute:retrieverRoute.capability_id,retrieverHelpers:retrieverRoute.helpers});
      if (activeOperationId !== operationId) return false;

      const routeDetail=operationWorker?`${operationWorker.displayName||operationWorker.name} accepted the outcome${moduleResolution.match?` via ${moduleResolution.match.moduleName}`:''}.`:moduleResolution.match?`Routed through ${moduleResolution.match.moduleName}`:'Titan Work is executing this outcome.';
      addAgentFeedItem(clean,'started',routeDetail,operationId,operationCompanyId);
      setOutcomeStatus(operationWorker?`${operationWorker.displayName||operationWorker.name} is connecting to Titan Work…`:'Connecting to Titan Work…','working');

      await waitForWorkBridge();
      if (activeOperationId !== operationId) return false;

      const requestId=operationId;
      const accepted=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pendingOutcomeRequests.delete(requestId);reject(new Error('Titan Work did not acknowledge the outcome.'));},8000);
        pendingOutcomeRequests.set(requestId,{resolve:(v)=>{clearTimeout(timer);resolve(v)},reject:(e)=>{clearTimeout(timer);reject(e)}});
      });
      const handoff = {
        ...envelope.handoff,
        capability_route: {selected:capabilityRoute?.selected||null,candidates:capabilityRoute?.candidates||[],confidence:capabilityRoute?.confidence??0,requires_model:capabilityRoute?.requires_model===true,execution_authority_granted:false},
        capability_route_confidence: capabilityRoute?.confidence??0,
        retriever_route: retrieverRoute,
        worker_route: operationWorker ? {
          id: operationWorker.id || null,
          name: operationWorker.displayName || operationWorker.name || null,
          vertical: serviceVertical
        } : { id:null, name:null, vertical:serviceVertical },
        module_route: moduleResolution.match ? {
          module_id: moduleResolution.match.moduleId || null,
          intent_id: moduleResolution.match.id || null,
          route: moduleResolution.match.route || null
        } : null
      };
      await chrome.storage.local.set({titanConversationRetrieverHandoff:{...handoff,outcome:clean,at:Date.now()}}).catch(()=>{});
      if (activeOperationId !== operationId) return false;

      frame.contentWindow.postMessage({type:'TITAN_EXECUTE_OUTCOME',requestId,outcome:executionPrompt,displayOutcome:clean,company_id:operationCompanyId,source,worker:operationWorker,handoff,context:{company_id:operationCompanyId,vertical:serviceVertical,module:moduleResolution.match?.moduleId||null,correlation_id:handoff.correlation_id,idempotency_key:handoff.idempotency_key,approval:handoff.approval,return_channel:handoff.return_channel,capability_route:handoff.capability_route,retriever_route:retrieverRoute}},'*');
      await accepted;
      if (activeOperationId !== operationId) return false;

      await publishConversationRetrieverLifecycle('accepted',{operation_id:operationId,correlation_id:handoff.correlation_id,idempotency_key:handoff.idempotency_key,company_id:operationCompanyId,text:`${retrieverRoute.label||'Retriever'} accepted the governed outcome`,retriever_route:retrieverRoute,source:'retriever-bridge'});
      await persistOutcome({operation_id:operationId,outcome:clean,source,state:'working',company_id:operationCompanyId,workerId:operationWorker?.id||null,workerName:operationWorker?.displayName||operationWorker?.name||null,startedAt:Date.now()});
      if (activeOperationId !== operationId) return false;

      setOutcomeStatus(operationWorker?`${operationWorker.displayName||operationWorker.name} working…`:'Agent working…','working');
      await chrome.storage.local.set({titanRetrieverBridgeState:{state:'running',requestId,outcome:clean,company_id:operationCompanyId,retriever_route:retrieverRoute,at:Date.now()}}).catch(()=>{});
      return activeOperationId === operationId;
    } catch (err) {
      // A superseded call must never write failure state into the newer active operation.
      if (activeOperationId !== operationId) {
        window.titanDiagWrite?.('info','outcome-bridge','Ignored superseded outcome completion/error',{operation_id:operationId,company_id:operationCompanyId||null});
        return false;
      }
      setOutcomeStatus('Could not start agent','error');
      if (operationCompanyId) {
        const failureText=String(err?.message || err || 'Could not hand this outcome to Titan Work.');
        addAgentFeedItem(clean,'failed','Could not hand this outcome to Titan Work. Open Work to retry or inspect Diagnostics.',operationId,operationCompanyId);
        await persistOutcome({operation_id:operationId,outcome:clean,source,state:'failed',detail:failureText,company_id:operationCompanyId,completedAt:Date.now()});
        await publishConversationRetrieverLifecycle('error',{operation_id:operationId,company_id:operationCompanyId,text:failureText,source:'titan-zero-dispatch'});
      }
      window.titanDiagWrite?.('error','outcome-bridge','Outcome dispatch failed',{message:err?.message,stack:err?.stack,operation_id:operationId,company_id:operationCompanyId||null});
      return false;
    }
  }

  const renderProgressInChat = (text, complete=false) => {
    let card=document.getElementById('titan-agent-progress-card');
    if (!card) {
      card=document.createElement('div');
      card.id='titan-agent-progress-card';
      card.className='titan-agent-progress-card';
      root?.prepend(card);
    }
    if (card) card.innerHTML=`<strong>${complete?`${escapeHtml(lastWorker?.displayName||lastWorker?.name||'Titan Work')} completed`:`${escapeHtml(lastWorker?.displayName||lastWorker?.name||'Titan Work')} is working`}</strong><span>${escapeHtml(String(text || '').slice(-500))}</span>`;
  };

  window.addEventListener('message', async event => {
    if (event.source !== frame?.contentWindow) return;
    const msg=event.data||{};
    if (msg.type==='TITAN_RETRIEVER_READY') {
      workBridgeReady=!!msg.composerReady;
      try { await chrome.storage.local.set({titanRetrieverBridgeState:{state:workBridgeReady?'ready':'loading',composerReady:workBridgeReady,at:Date.now()}}); } catch(_) {}
      if (workBridgeReady && !activeOperationId) setOutcomeStatus('Ready for an outcome');
      return;
    }
    if (msg.type==='TITAN_OUTCOME_ACCEPTED') {
      // Acceptance must bind to the exact active request and canonical company boundary
      // before it can resolve a pending dispatch promise.
      if (!activeOperationId || msg.requestId !== activeOperationId) return;
      if (!activeCompanyId || String(msg.company_id || '').trim() !== activeCompanyId) return;
      const pending=pendingOutcomeRequests.get(msg.requestId);
      if (pending) { pendingOutcomeRequests.delete(msg.requestId); pending.resolve(msg); }
      return;
    }
    if (!['TITAN_OUTCOME_PROGRESS','TITAN_OUTCOME_RESULT','TITAN_OUTCOME_ERROR'].includes(msg.type)) return;
    // Fail closed: execution lifecycle events require the exact active operation ID.
    // Do not accept uncorrelated or missing request IDs from the embedded runtime.
    if (!activeOperationId || msg.requestId !== activeOperationId) return;
    // Reject cross-company or boundary-less lifecycle events even when request correlation is valid.
    if (!activeCompanyId || String(msg.company_id || '').trim() !== activeCompanyId) return;
    const complete=msg.type==='TITAN_OUTCOME_RESULT';
    const failed=msg.type==='TITAN_OUTCOME_ERROR';
    const text=String(msg.text||msg.message||(failed?'Retriever execution failed.':complete?'Retriever execution completed.':'Retriever is working…')).trim();
    if (text && text!==lastProgressText) {
      lastProgressText=text;
      renderProgressInChat(text,complete);
      setOutcomeStatus(complete?'Outcome complete':failed?'Agent needs attention':'Agent working…',failed?'error':complete?'complete':'working');
      const currentHandoff=(await chrome.storage.local.get(['titanConversationRetrieverHandoff']).catch(()=>({}))).titanConversationRetrieverHandoff||{};
      await publishConversationRetrieverLifecycle(failed?'error':complete?'complete':'progress',{operation_id:activeOperationId,correlation_id:msg.correlation_id||activeOperationId,idempotency_key:msg.idempotency_key||activeOperationId,company_id:activeCompanyId,text,task_id:msg.taskId||null,retriever_route:currentHandoff.retriever_route||null,source:msg.source||'retriever'});
      if (complete || failed) {
        const state=complete?'complete':'attention';
        await persistOutcome({operation_id:activeOperationId,outcome:lastOutcome,state,detail:text,company_id:activeCompanyId,completedAt:Date.now(),correlation_id:msg.correlation_id||activeOperationId,idempotency_key:msg.idempotency_key||activeOperationId});
        addAgentFeedItem(lastOutcome,state,text.slice(-260),activeOperationId,activeCompanyId);
        const returned = {
          schema:'titan-conversation-retriever-result/v1',
          operation_id:activeOperationId,
          correlation_id:msg.correlation_id||activeOperationId,
          idempotency_key:msg.idempotency_key||activeOperationId,
          company_id:activeCompanyId,
          state,
          text,
          worker:lastWorker,
          source:msg.source||'retriever',
          task_id:msg.taskId||null,
          returned_at:Date.now()
        };
        window.dispatchEvent(new CustomEvent('titan:conversation-execution-result',{detail:returned}));
        window.postMessage({type:'TITAN_CONVERSATION_EXECUTION_RESULT',payload:returned},'*');
        await chrome.storage.local.set({titanConversationRetrieverResult:returned}).catch(()=>{});
        // Retire the terminal operation only after all result persistence/publication completes.
        // This makes duplicate terminal events and late progress fail the active-operation correlation gate.
        activeOperationId='';
      }
    }
  });

  frame?.addEventListener('load',()=>{
    workBridgeReady=false;
    setTimeout(()=>{try{frame.contentWindow?.postMessage({type:'TITAN_RETRIEVER_PING',requestId:`load-${Date.now()}`},'*')}catch(_){}},250);
  });

  function installChatOutcomeBridge() {
    if (!root) return;
    const hook = () => {
      const inputs=[...root.querySelectorAll('textarea,[contenteditable="true"]')].filter(isVisible);
      inputs.forEach(input=>{
        if (input.dataset.titanOutcomeHooked) return;
        input.dataset.titanOutcomeHooked='1';
        input.addEventListener('keydown', async event=>{
          if (!outcomeMode || event.key!=='Enter' || event.shiftKey || event.isComposing) return;
          const text=input.isContentEditable?input.textContent:input.value;
          if (!String(text||'').trim()) return;
          event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
          const ok=await dispatchOutcomeToWork(text,'chat');
          if (ok) {
            if (input.isContentEditable) input.textContent=''; else input.value='';
            input.dispatchEvent(new Event('input',{bubbles:true}));
          }
        },true);
      });
    };
    hook();
    new MutationObserver(hook).observe(root,{childList:true,subtree:true});
    root.addEventListener('submit',async event=>{
      if (!outcomeMode) return;
      const form=event.target;
      const input=form?.querySelector?.('textarea,[contenteditable="true"],input[type="text"]');
      const text=input?(input.isContentEditable?input.textContent:input.value):'';
      if (!String(text||'').trim()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const ok=await dispatchOutcomeToWork(text,'chat');
      if(ok && input){
        if(input.isContentEditable) input.textContent=''; else input.value='';
        input.dispatchEvent(new Event('input',{bubbles:true}));
      }
    },true);
  }

  window.addEventListener('titan:outcome', event => {
    const outcome=event.detail?.outcome;
    const source=event.detail?.source || 'shell';
    dispatchOutcomeToWork(outcome,source);
  });

  toggle?.addEventListener('click',()=>{
    outcomeMode=!outcomeMode;
    mode?.classList.toggle('active',outcomeMode);
    toggle.setAttribute('aria-pressed',String(outcomeMode));
    setOutcomeStatus(outcomeMode?'Ready for an outcome':'Chat-only mode');
  });
  installChatOutcomeBridge();
})();
