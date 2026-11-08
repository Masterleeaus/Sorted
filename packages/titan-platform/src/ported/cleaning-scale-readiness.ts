// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): cleaning-scale-readiness.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
(()=>{'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
let config={},rows=[];
const label=id=>[...($('growth-opportunity-filter')?.options||[])].find(o=>o.value===id)?.textContent||id;
const pct=v=>v===null||v===undefined?'—':`${Number(v).toFixed(1)}%`;
function contributionSpread(pilots){const vals=pilots.map(p=>Number(p.actual_contribution)).filter(Number.isFinite);if(vals.length<2)return null;const mean=vals.reduce((a,b)=>a+b,0)/vals.length;if(mean===0)return vals.every(v=>v===0)?0:null;return ((Math.max(...vals)-Math.min(...vals))/Math.abs(mean))*100;}
function assess(line){
 const service_line=line.service_line,plan=line.plan||{},model=line.model||{},all=[...(line.pilots||[])].sort((a,b)=>String(a.completed_at||a.recorded_at||'').localeCompare(String(b.completed_at||b.recorded_at||'')));
 const validated=all.filter(p=>p.overall_validation!=='insufficient_evidence');
 const c=config.controlled_rollout||{},b=config.broader_rollout||{};
 const recentC=validated.slice(-Number(c.pilot_window||3)),recentB=validated.slice(-Number(b.pilot_window||4));
 const qualityIssues=all.filter(p=>['rework_required','failed'].includes(p.quality_outcome)).length;
 const customerIssues=all.filter(p=>['dissatisfied','complaint'].includes(p.customer_outcome)).length;
 const optimisticC=recentC.filter(p=>p.overall_validation==='assumptions_optimistic').length;
 const optimisticB=recentB.filter(p=>p.overall_validation==='assumptions_optimistic').length;
 const spread=contributionSpread(recentB);
 const recentContributions=recentB.map(p=>Number(p.actual_contribution)).filter(Number.isFinite);
 const allRecentPositive=recentContributions.length===recentB.length&&recentContributions.every(v=>v>0);
 const hard=[];
 if(c.require_planner_ready_to_sell&&!plan.ready_to_sell)hard.push('Service Launch Planner is not ready to sell.');
 if(c.require_positive_model_contribution&&model.positive_contribution!==true)hard.push('Commercial model does not have a confirmed positive contribution per job.');
 if(c.block_budget_overrun&&model.budget_status==='exceeds')hard.push('Known launch investment exceeds the company-entered budget cap.');
 if(c.block_quality_issues&&qualityIssues)hard.push(`${qualityIssues} recorded pilot quality issue${qualityIssues===1?'':'s'} require review.`);
 if(c.block_customer_issues&&customerIssues)hard.push(`${customerIssues} recorded customer issue${customerIssues===1?'':'s'} require review.`);
 let recommendation='hold',reason='Hard rollout gate is not satisfied.';
 const controlledEvidence=validated.length>=Number(c.minimum_validated_pilots||2);
 const controlledPattern=optimisticC<=Number(c.maximum_optimistic_pilots_in_window??0);
 const broaderEvidence=validated.length>=Number(b.minimum_validated_pilots||4);
 const broaderPattern=optimisticB<=Number(b.maximum_optimistic_pilots_in_window??0);
 const broaderConsistency=spread!==null&&spread<=Number(b.maximum_contribution_spread_percent||20);
 if(!hard.length){
   if(!controlledEvidence||!controlledPattern){recommendation='run_another_pilot';reason=!controlledEvidence?`Need ${Math.max(0,Number(c.minimum_validated_pilots||2)-validated.length)} more comparable pilot${Math.max(0,Number(c.minimum_validated_pilots||2)-validated.length)===1?'':'s'} for controlled-rollout evidence.`:'Recent pilot evidence still shows optimistic assumptions; validate again before rollout.';}
   else if(broaderEvidence&&broaderPattern&&broaderConsistency&&(!b.require_all_recent_contributions_positive||allRecentPositive)){recommendation='ready_broader_rollout';reason='Repeated pilot evidence is sufficient and commercially consistent for a broader-rollout recommendation.';}
   else {recommendation='ready_controlled_rollout';reason='Minimum controlled-rollout evidence is satisfied; broader-rollout evidence or consistency is not yet sufficient.';}
 }
 const confidence=hard.length?'blocked':validated.length>=Number(b.minimum_validated_pilots||4)&&broaderConsistency?'high':validated.length>=Number(c.minimum_validated_pilots||2)?'medium':'low';
 return {service_line,name:line.name||label(service_line),recommendation,reason,confidence,validated_pilots:validated.length,total_pilots:all.length,quality_issues:qualityIssues,customer_issues:customerIssues,recent_optimistic:optimisticC,contribution_spread_percent:spread,planner_ready:!!plan.ready_to_sell,positive_model_contribution:model.positive_contribution===true,budget_status:model.budget_status||'not_set',hard_blockers:hard,grants_authority:false,approves_scaling:false,approves_spend:false,publishes_service:false,schedules_work:false,executes_work:false};
}
const badge=r=>r==='ready_broader_rollout'?['verified','Ready for broader rollout']:r==='ready_controlled_rollout'?['verified','Ready for controlled rollout']:r==='run_another_pilot'?['warn','Run another pilot']:['danger','Hold'];
function source(){return window.TitanCleaningPilotValidation?.getServiceValidations?.()||[]}
function get(){return source().map(assess)}
function render(){rows=get();let list=rows;const f=$('scale-readiness-filter')?.value||'tracked';if(f==='action')list=list.filter(r=>['hold','run_another_pilot'].includes(r.recommendation));if(f==='controlled')list=list.filter(r=>r.recommendation==='ready_controlled_rollout');if(f==='broader')list=list.filter(r=>r.recommendation==='ready_broader_rollout');if(f==='tracked')list=list.filter(r=>r.total_pilots>0||r.planner_ready);
 const sums=rows.reduce((a,r)=>(a[r.recommendation]=(a[r.recommendation]||0)+1,a),{});if($('scale-readiness-count'))$('scale-readiness-count').textContent=`${rows.filter(r=>r.total_pilots||r.planner_ready).length} assessed service${rows.filter(r=>r.total_pilots||r.planner_ready).length===1?'':'s'}`;if($('scale-readiness-summary'))$('scale-readiness-summary').innerHTML=`<div><strong>${sums.hold||0}</strong><span>Hold</span></div><div><strong>${sums.run_another_pilot||0}</strong><span>Another pilot</span></div><div><strong>${sums.ready_controlled_rollout||0}</strong><span>Controlled rollout</span></div><div><strong>${sums.ready_broader_rollout||0}</strong><span>Broader rollout</span></div>`;
 if(!$('scale-readiness-list'))return;$('scale-readiness-list').innerHTML=list.length?list.map(r=>{const b=badge(r.recommendation);return `<article class="supply-card scale-readiness-card"><div class="supply-card-head"><div><div class="module-title"><strong>${esc(r.name)}</strong><span class="pill ${b[0]}">${b[1]}</span></div><div class="meta"><span>${r.validated_pilots} comparable pilot${r.validated_pilots===1?'':'s'}</span><span>${esc(r.confidence)} evidence confidence</span><span>Contribution spread ${esc(pct(r.contribution_spread_percent))}</span></div></div></div><div class="scale-readiness-reason"><strong>${esc(r.reason)}</strong><span>This is an advisory recommendation only. It does not authorize rollout.</span></div>${r.hard_blockers.length?`<div class="launch-blockers"><strong>Scale blockers</strong>${r.hard_blockers.map(x=>`<span>• ${esc(x)}</span>`).join('')}</div>`:''}<div class="economics-summary"><div><strong>${r.planner_ready?'Yes':'No'}</strong><span>Planner ready</span></div><div><strong>${r.positive_model_contribution?'Yes':'No'}</strong><span>Positive model contribution</span></div><div><strong>${esc(r.budget_status)}</strong><span>Budget status</span></div><div><strong>${r.quality_issues+r.customer_issues}</strong><span>Recorded outcome issues</span></div></div><div class="purchase-actions"><button data-scale-pilots="${esc(r.service_line)}">Review pilot evidence</button><button data-scale-plan="${esc(r.service_line)}">Review launch plan</button></div></article>`}).join(''):'<div class="empty">No service scale-readiness records match this view.</div>';
 document.querySelectorAll('[data-scale-pilots]').forEach(b=>b.onclick=()=>document.querySelector('.pilot-validation')?.scrollIntoView({behavior:'smooth',block:'start'}));document.querySelectorAll('[data-scale-plan]').forEach(b=>b.onclick=()=>document.querySelector('.service-launch-planner')?.scrollIntoView({behavior:'smooth',block:'start'}));}
async function init(){try{config=await fetch(chrome.runtime.getURL('titan-modules/cleaning-scale-readiness.json')).then(r=>r.json());if(config.schema!=='titan-cleaning-scale-readiness/v1')throw new Error('scale readiness configuration is invalid');render();}catch(e){if($('scale-readiness-notice'))$('scale-readiness-notice').textContent=`Scale readiness unavailable: ${e.message}`;}}
$('scale-readiness-filter')?.addEventListener('change',render);['titan-cleaning-pilot-outcomes-changed','titan-cleaning-launch-economics-changed','titan-cleaning-service-launch-plan-changed','titan-marketplace-coverage-changed'].forEach(ev=>window.addEventListener(ev,render));window.addEventListener('titan-company-changed',init);
window.TitanCleaningScaleReadiness=Object.freeze({getAssessments:()=>get(),assess,companyId:()=>window.TitanCleaningPilotValidation?.companyId?.()||'company-default',grantsAuthority:false,approvesScaling:false,approvesSpend:false});init();})();
