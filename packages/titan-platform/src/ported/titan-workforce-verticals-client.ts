// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-workforce-verticals-client.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Workforce Verticals module client adapter. The packaged module manifest is canonical. */
(() => {
  const state={verticals:{},workers:[],byId:{},manifest:null,error:null};
  const norm=s=>String(s||'').toLowerCase();
  const asWorker=raw=>({
    id:raw.id,roleDefinitionId:raw.id,role_definition_id:raw.id,name:raw.name,
    displayName:`${state.verticals[raw.vertical]?.name||raw.vertical||'Service'} · ${raw.name}`,
    icon:state.verticals[raw.vertical]?.icon||'🛠️',department:raw.department||'work',
    capabilities:raw.capabilities||[],operational_domains:raw.capabilities||[],autonomy:raw.autonomy||'governed',
    riskCeiling:raw.riskCeiling||'LOW',risk_ceiling:raw.riskCeiling||'LOW',description:raw.description||raw.role||'',purpose:raw.description||raw.role||'',
    source:'Titan Workforce Verticals module',companyBoundary:'company_id',company_boundary:'company_id',activationConfersAuthority:false,activation_confers_authority:false,
    vertical:raw.vertical,verticals:[raw.vertical],evidenceRequired:raw.evidenceRequired||[],approvalRequiredFor:raw.approvalRequiredFor||[]
  });
  const load=async()=>{
    try{
      const response=await fetch(chrome.runtime.getURL('titan-modules/builtin/workforce-verticals/manifest.json'));
      if(!response.ok) throw new Error(`vertical module manifest ${response.status}`);
      const manifest=await response.json(); state.manifest=manifest;
      state.verticals=Object.fromEntries((manifest.contributes?.verticals||[]).map(v=>[v.id,v]));
      state.workers=(manifest.contributes?.workers||[]).map(asWorker);state.byId=Object.fromEntries(state.workers.map(w=>[w.id,w]));
      try{await chrome.storage.local.set({titanWorkforceVerticalModuleVersion:manifest.version,titanWorkforceVerticalCount:Object.keys(state.verticals).length,titanWorkforceVerticalWorkerCount:state.workers.length})}catch{}
      return state;
    }catch(error){state.error=String(error?.message||error);return state;}
  };
  const ready=load();
  const specialistsFor=vertical=>state.workers.filter(w=>w.vertical===vertical);
  const route=(outcome,vertical,preferredId=null)=>{
    const roster=specialistsFor(vertical); if(preferredId&&state.byId[preferredId]?.vertical===vertical)return state.byId[preferredId];
    const t=norm(outcome);let best=null,bestScore=0;
    for(const w of roster){let score=0;for(const token of [w.name,w.description,...(w.capabilities||[])]){const n=norm(token).replace(/[_-]+/g,' ');if(n&&t.includes(n))score+=3;for(const part of n.split(/\s+/).filter(x=>x.length>4))if(t.includes(part))score+=1;}if(score>bestScore){best=w;bestScore=score;}}
    return bestScore>=2?best:null;
  };
  window.TitanWorkforceVerticals={state,ready,get verticals(){return state.verticals},get workers(){return state.workers},get byId(){return state.byId},specialistsFor,route};
})();
