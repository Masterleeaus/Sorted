// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-navigation-registry.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
/* Titan Zero navigation contribution runtime — Step 3 */
(() => {
  const tabs=[...document.querySelectorAll('.titan-tab[data-view]')];
  const tablist=document.querySelector('.titan-tabs');
  if (!tablist || !tabs.length) return;
  tablist.setAttribute('role','tablist');
  tablist.setAttribute('aria-label','Titan Zero workspace navigation');
  const activateSemantics=(active)=>{
    tabs.forEach(tab=>{
      const selected=tab.dataset.view===active;
      tab.setAttribute('role','tab');
      tab.setAttribute('aria-selected',String(selected));
      tab.setAttribute('tabindex',selected?'0':'-1');
      tab.setAttribute('aria-controls',`titan-${tab.dataset.view}-view`);
    });
  };
  tabs.forEach((tab,index)=>{
    tab.setAttribute('role','tab');
    tab.setAttribute('aria-controls',`titan-${tab.dataset.view}-view`);
    tab.addEventListener('keydown',event=>{
      let next=null;
      if(event.key==='ArrowRight') next=(index+1)%tabs.length;
      if(event.key==='ArrowLeft') next=(index-1+tabs.length)%tabs.length;
      if(event.key==='Home') next=0;
      if(event.key==='End') next=tabs.length-1;
      if(next===null) return;
      event.preventDefault(); tabs[next].focus(); tabs[next].click();
    });
  });
  const observer=new MutationObserver(()=>activateSemantics(document.body.dataset.titanView||'chat'));
  observer.observe(document.body,{attributes:true,attributeFilter:['data-titan-view']});
  activateSemantics(document.body.dataset.titanView||document.querySelector('.titan-tab.active')?.dataset.view||'chat');
  window.TitanZeroNavigation={tabs,activateSemantics};
  window.dispatchEvent(new CustomEvent('titan:navigation-ready',{detail:{views:tabs.map(t=>t.dataset.view)}}));
})();
