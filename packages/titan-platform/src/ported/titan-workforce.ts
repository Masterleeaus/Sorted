// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-workforce.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero AI Workforce registry, compatibility mapper and capability router. */
(() => {
  const WORKERS = [
    {id:'writing-communications',name:'Writing & Communications Worker',legacy:['Writing Assistant','AI Writing','Grammar Corrector','AI Reply','Story Generator'],icon:'✍',department:'Communications',capabilities:['writing','rewrite','grammar','email','reply','proposal','report','story'],autonomy:'draft',description:'Drafts, rewrites and improves business communications and long-form content.'},
    {id:'research-intelligence',name:'Research & Intelligence Worker',legacy:['Search Assistant','Smart Search','Web Access'],icon:'⌕',department:'Intelligence',capabilities:['research','search','investigate','compare','verify','risks','findings'],autonomy:'investigate',description:'Researches, investigates, compares evidence and returns decision-ready findings.'},
    {id:'reading-knowledge',name:'Reading & Knowledge Worker',legacy:['Reading Assistant','Reading Tool','Page Summary','YouTube Summary','Video Summary'],icon:'▤',department:'Knowledge',capabilities:['read','summarise','summarize','extract','page','youtube','video','knowledge'],autonomy:'read',description:'Reads pages, files and media, extracts evidence and produces structured summaries.'},
    {id:'translation-localization',name:'Translation & Localization Worker',legacy:['Translate','AI Translate','Web Translation','Translation'],icon:'文',department:'Communications',capabilities:['translate','translation','localise','localize','language','glossary'],autonomy:'draft',description:'Translates and localises content while preserving terminology and business context.'},
    {id:'marketing-social',name:'Marketing & Social Worker',legacy:['Social Media Writing Assistant','Social Media','Marketing'],icon:'◎',department:'Growth',capabilities:['social','marketing','campaign','caption','post','seo','listing'],autonomy:'draft',description:'Creates governed marketing, social and campaign content tied to business outcomes.'},
    {id:'documents-analysis',name:'Documents & Analysis Worker',legacy:['Doc Chat','Chat with PDF','PDF Tools','Document Chat'],icon:'▧',department:'Operations',capabilities:['pdf','document','file','contract','invoice','extract','analyse','analyze'],autonomy:'read',description:'Reviews PDFs and business documents, extracts facts and prepares analysis.'},
    {id:'technical-engineering',name:'Technical & Engineering Worker',legacy:['Code Tools','Code Assistant','Coding'],icon:'</>',department:'Engineering',capabilities:['code','debug','script','technical','developer','programming','error'],autonomy:'execute-with-approval',description:'Investigates technical problems, drafts code and coordinates governed technical execution.'},
    {id:'creative-media',name:'Creative & Media Worker',legacy:['Image Tools','AI Art','Artist','Image Generation','Video Generation'],icon:'◇',department:'Creative',capabilities:['image','visual','video','creative','design','art','media'],autonomy:'draft',description:'Plans and produces visual/media assets using available creative capabilities.'},
    {id:'customer-comms',name:'Customer Communications Worker',legacy:['Email Assistant','Reply Assistant'],icon:'◉',department:'Customer',capabilities:['customer','client','reply','follow-up','follow up','support','inbox'],autonomy:'draft',description:'Handles customer-facing drafts, follow-ups and communication preparation.'},
    {id:'browser-operations',name:'Browser Operations Worker',legacy:['Agent','Browser Agent','Retriever AI','Retriever'],icon:'↻',department:'Operations',capabilities:['browser','click','open','submit','workflow','task','execute','book','schedule','update'],autonomy:'execute-with-approval',description:'Carries out browser tasks and multi-step workflows through Titan Work.'}
  ];
  const byId=Object.fromEntries(WORKERS.map(w=>[w.id,w]));
  const clientWorkerById=id=>window.TitanClientWorkforce?.byId?.[id]?window.TitanClientWorkforce.roleAsWorker(window.TitanClientWorkforce.byId[id],'general_field_services'):null;
  const normalize=s=>String(s||'').toLowerCase();
  const scoreWorker=(worker,text)=>worker.capabilities.reduce((s,k)=>s+(normalize(text).includes(k)?3:0),0);
  const route=(outcome,preferredId=null,context={})=>{
    if(preferredId&&byId[preferredId]) return byId[preferredId];
    const vertical=context.vertical||context.serviceVertical||'general_field_services';
    if(preferredId){ const op=clientWorkerById(preferredId); if(op) return {...op,vertical}; }
    if(window.TitanClientWorkforce?.shouldHandle?.(outcome,vertical)){
      const op=window.TitanClientWorkforce.route(outcome,vertical,context.businessTier||'SOLO',preferredId);
      if(op) return op;
    }
    const text=normalize(outcome);
    const priority=[
      ['translation-localization',/\b(translate|translation|localise|localize|localisation|localization|glossary)\b/],
      ['technical-engineering',/\b(debug|code|script|javascript|typescript|python|programming|syntax|stack trace|technical error)\b/],
      ['documents-analysis',/\b(pdf|document|contract|attachment|file analysis|analyse this file|analyze this file)\b/],
      ['marketing-social',/\b(social media|campaign|caption|seo|listing|marketing post|instagram|linkedin|facebook)\b/],
      ['research-intelligence',/\b(research|investigate|competitor|verify|evidence|compare sources|due diligence)\b/],
      ['reading-knowledge',/\b(summarise|summarize|read this|page summary|youtube summary|video summary|extract key)\b/],
      ['creative-media',/\b(generate image|create image|design visual|generate video|creative asset|artwork)\b/],
      ['customer-comms',/\b(customer|client|support|follow[- ]?up|inbox)\b.*\b(email|reply|message|contact)|\b(email|reply|message)\b.*\b(customer|client|support)\b/],
      ['writing-communications',/\b(write|rewrite|draft|proofread|grammar|proposal|report|article|story)\b/],
      ['browser-operations',/\b(open|click|submit|book|schedule|update|execute|workflow|browser|crm)\b/]
    ];
    for(const [id,re] of priority) if(re.test(text)) return byId[id];
    const ranked=WORKERS.map(w=>({w,s:scoreWorker(w,text)})).sort((a,b)=>b.s-a.s);
    return ranked[0]?.s>0?ranked[0].w:byId['browser-operations'];
  };
  const executionPrompt=(worker,outcome)=>{
    if(worker?.vertical==='cleaning' && window.TitanCleaningWorkforce?.byId?.[worker.id]) return window.TitanCleaningWorkforce.executionContract(worker,outcome);
    if(worker?.vertical==='plumbing' && window.TitanPlumbingWorkforce?.byId?.[worker.id]) return window.TitanPlumbingWorkforce.executionContract(worker,outcome);
    if(worker?.vertical==='electrical' && window.TitanElectricalWorkforce?.byId?.[worker.id]) return window.TitanElectricalWorkforce.executionContract(worker,outcome);
    return `WORKFORCE ASSIGNMENT\nWorker: ${worker.name}\nDepartment: ${worker.department}\nAutonomy: ${worker.autonomy}\nCapabilities: ${worker.capabilities.join(', ')}\n\nOperating contract:\n- Work toward the requested outcome, not merely a conversational answer.\n- Use available tools and browser actions when needed.\n- Preserve evidence and report what was actually completed.\n- Do not claim execution that did not occur.\n- Surface blockers, approvals and errors clearly.\n\nRequested outcome:\n${String(outcome||'').trim()}`;
  };
  const legacyMap=[]; WORKERS.forEach(w=>w.legacy.forEach(label=>legacyMap.push([label,w.name])));
  const replaceLegacyText=text=>{let out=String(text||''); for(const [from,to] of legacyMap){out=out.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}\\b`,'gi'),to)} return out;};
  const persistRoster=()=>chrome.storage?.local?.set?.({titanWorkforceRoster:WORKERS.map(({legacy,...w})=>w),titanWorkforceSchemaVersion:1}).catch?.(()=>{});
  const setPreferredWorker=id=>{ const worker=byId[id]||clientWorkerById(id); if(!worker) return; try{chrome.storage.local.set({titanPreferredWorker:id})}catch(_){}; window.dispatchEvent(new CustomEvent('titan-worker-selected',{detail:worker})); };
  const getPreferredWorker=async()=>{try{const d=await chrome.storage.local.get(['titanPreferredWorker']);return d.titanPreferredWorker&&(byId[d.titanPreferredWorker]||window.TitanClientWorkforce?.byId?.[d.titanPreferredWorker])?d.titanPreferredWorker:null}catch{return null}};
  const getWorkerById=id=>byId[id]||clientWorkerById(id);
  const sendNativeWorkforceMessage=(type,payload)=>{
    try{
      const result=chrome.runtime?.sendMessage?.({type,payload});
      return result&&typeof result.then==='function'?result:Promise.resolve(result);
    }catch(error){return Promise.reject(error)}
  };
  const submitInvestigationParticipation=packet=>sendNativeWorkforceMessage('TITAN_INVESTIGATION_PARTICIPATION',packet);
  if(!window.__TITAN_WORKFORCE_NATIVE_BRIDGE__){
    window.__TITAN_WORKFORCE_NATIVE_BRIDGE__=true;
    window.addEventListener('titan-workforce-control-intent',event=>{
      const intent=event?.detail;
      if(!intent||typeof intent!=='object') return;
      sendNativeWorkforceMessage('TITAN_WORKFORCE_CONTROL_INTENT',intent).catch(error=>window.titanDiagWrite?.('warn','workforce-native-bridge','Unable to persist workforce control intent',{message:error.message,company_id:intent.company_id||null}));
    });
  }
  window.TitanWorkforce={workers:WORKERS,byId,getWorkerById,route,executionPrompt,replaceLegacyText,setPreferredWorker,getPreferredWorker,submitInvestigationParticipation,nativeRuntimeProtocol:'titan.runtime.v1'};
  persistRoster();
})();
