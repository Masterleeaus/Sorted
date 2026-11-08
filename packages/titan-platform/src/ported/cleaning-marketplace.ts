// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): cleaning-marketplace.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money=(n,currency='AUD')=>Number.isFinite(Number(n))?new Intl.NumberFormat(undefined,{style:'currency',currency}).format(Number(n)):'—';
const STORE='titanCleaningSupplyMarketplaceV1';
let catalog={products:[],categories:[],kits:[]}, state={company_id:'company-default',currency:'AUD',inventory:{},cart:{},orders:[]}, filters={query:'',category:'all',job:'all',low:false};

async function getStore(){
  const profile=await chrome.storage.local.get(['titanBusinessProfile',STORE]);
  const company=String(profile.titanBusinessProfile?.company_id||$('grant-company')?.value||'company-default').trim()||'company-default';
  const root=profile[STORE]||{};
  return {company,root,companyState:root[company]||{company_id:company,currency:'AUD',inventory:{},cart:{},orders:[]}};
}
async function save(){
  const got=await chrome.storage.local.get([STORE]);const root=got[STORE]||{};root[state.company_id]=state;await chrome.storage.local.set({[STORE]:root});
}
function itemState(id){return state.inventory[id]||{on_hand:0,par:0,unit_cost:null,supplier:'',supplier_sku:'',preferred:false};}
function qty(id){return Number(state.cart[id]||0);}
function product(id){return catalog.products.find(p=>p.id===id);}
function categoryName(id){return catalog.categories.find(c=>c.id===id)?.name||id;}
function isLow(p){const x=itemState(p.id);return Number(x.par)>0&&Number(x.on_hand)<=Number(x.par);}
function cartLines(){return Object.entries(state.cart).filter(([,q])=>Number(q)>0).map(([id,q])=>({product:product(id),qty:Number(q),...itemState(id)})).filter(x=>x.product);}
function cartTotal(){return cartLines().reduce((n,l)=>n+(Number(l.unit_cost)||0)*l.qty,0);}
function notify(message,error=false){const el=$('supply-notice');if(!el)return;el.textContent=message||'';el.className=error?'error':'';}

function renderFilters(){
  $('supply-category').innerHTML='<option value="all">All categories</option>'+catalog.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  $('supply-category').value=filters.category;
}
function renderMetrics(){
  const configured=catalog.products.filter(p=>Number(itemState(p.id).par)>0).length;
  const low=catalog.products.filter(isLow).length;
  const preferred=catalog.products.filter(p=>itemState(p.id).preferred).length;
  const open=state.orders.filter(o=>o.status!=='received').length;
  $('supply-summary').innerHTML=[['Products',catalog.products.length],['Stock tracked',configured],['Low / reorder',low],['Preferred',preferred],['Cart lines',cartLines().length],['Open orders',open]].map(([a,b])=>`<div><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join('');
}
function matches(p){
  const q=filters.query.toLowerCase();
  if(filters.category!=='all'&&p.category!==filters.category)return false;
  if(filters.job!=='all'&&!p.job_types.includes(filters.job)&&!p.job_types.includes('all'))return false;
  if(filters.low&&!isLow(p))return false;
  return !q||[p.name,p.id,categoryName(p.category),...(p.tags||[])].join(' ').toLowerCase().includes(q);
}
function renderProducts(){
  const products=catalog.products.filter(matches);
  $('supply-result-count').textContent=`${products.length} shown`;
  $('supply-products').innerHTML=products.length?products.map(p=>{const s=itemState(p.id),low=isLow(p);return `<article class="supply-card ${low?'low-stock':''}">
    <div class="supply-card-head"><div><div class="module-title"><strong>${esc(p.name)}</strong>${s.preferred?'<span class="pill verified">PREFERRED</span>':''}${low?'<span class="pill warn">REORDER</span>':''}</div><div class="meta"><span>${esc(categoryName(p.category))}</span><span>${esc(p.unit)}</span><span>${esc((p.tags||[]).join(' · '))}</span></div></div><button class="supply-star" data-preferred="${esc(p.id)}" aria-label="Toggle preferred">${s.preferred?'★':'☆'}</button></div>
    ${p.safety?`<p class="safety-note">${esc(p.safety)}</p>`:''}
    <div class="supply-fields">
      <label>On hand<input type="number" min="0" step="1" data-field="on_hand" data-id="${esc(p.id)}" value="${esc(s.on_hand)}"></label>
      <label>Reorder at<input type="number" min="0" step="1" data-field="par" data-id="${esc(p.id)}" value="${esc(s.par)}"></label>
      <label>Unit cost<input type="number" min="0" step="0.01" placeholder="optional" data-field="unit_cost" data-id="${esc(p.id)}" value="${s.unit_cost==null?'':esc(s.unit_cost)}"></label>
      <label>Supplier<input type="text" placeholder="preferred supplier" data-field="supplier" data-id="${esc(p.id)}" value="${esc(s.supplier)}"></label>
      <label>Supplier SKU<input type="text" placeholder="optional" data-field="supplier_sku" data-id="${esc(p.id)}" value="${esc(s.supplier_sku)}"></label>
    </div>
    <div class="supply-actions"><button data-add="${esc(p.id)}">Add to order</button>${low?`<button class="featured" data-reorder="${esc(p.id)}">Add reorder qty</button>`:''}</div>
  </article>`}).join(''):'<div class="empty">No cleaning supplies match these filters.</div>';
  bindProductEvents();
}
function bindProductEvents(){
  document.querySelectorAll('[data-field]').forEach(input=>input.onchange=async()=>{const s=itemState(input.dataset.id);let v=input.value;if(['on_hand','par','unit_cost'].includes(input.dataset.field))v=v===''?null:Number(v);state.inventory[input.dataset.id]={...s,[input.dataset.field]:v};await save();renderAll();});
  document.querySelectorAll('[data-preferred]').forEach(b=>b.onclick=async()=>{const id=b.dataset.preferred,s=itemState(id);state.inventory[id]={...s,preferred:!s.preferred};await save();renderAll();});
  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=async()=>{state.cart[b.dataset.add]=qty(b.dataset.add)+1;await save();renderAll();notify(`Added ${product(b.dataset.add)?.name||'item'} to purchase order.`);});
  document.querySelectorAll('[data-reorder]').forEach(b=>b.onclick=async()=>{const id=b.dataset.reorder,s=itemState(id);const needed=Math.max(1,Number(s.par||0)-Number(s.on_hand||0)+1);state.cart[id]=qty(id)+needed;await save();renderAll();notify(`Added ${needed} × ${product(id)?.name||'item'} for replenishment.`);});
}
function renderKits(){
  $('supply-kits').innerHTML=catalog.kits.map(k=>`<article class="kit-card"><div><strong>${esc(k.name)}</strong><p>${esc(k.description)}</p><div class="meta"><span>${k.lines.length} product lines</span><span>${esc(k.job_type)}</span></div></div><button data-kit="${esc(k.id)}">Add kit</button></article>`).join('');
  document.querySelectorAll('[data-kit]').forEach(b=>b.onclick=async()=>{const kit=catalog.kits.find(k=>k.id===b.dataset.kit);kit.lines.forEach(([id,q])=>state.cart[id]=qty(id)+Number(q));await save();renderAll();notify(`Added ${kit.name} to the purchase order.`);});
}
function renderCart(){
  const lines=cartLines();$('supply-cart-count').textContent=`${lines.length} line${lines.length===1?'':'s'}`;
  $('supply-cart').innerHTML=lines.length?lines.map(l=>`<div class="cart-line"><div><strong>${esc(l.product.name)}</strong><span>${esc(l.product.unit)}${l.supplier?` · ${esc(l.supplier)}`:''}</span></div><div class="cart-controls"><button data-dec="${esc(l.product.id)}">−</button><input data-cartqty="${esc(l.product.id)}" type="number" min="1" step="1" value="${l.qty}"><button data-inc="${esc(l.product.id)}">+</button><span>${l.unit_cost==null?'cost not set':money(Number(l.unit_cost)*l.qty,state.currency)}</span><button class="danger" data-remove-cart="${esc(l.product.id)}">Remove</button></div></div>`).join(''):'<div class="empty">Your purchase order is empty. Add products or a job kit.</div>';
  $('supply-total').textContent=lines.length?`Known-cost total: ${money(cartTotal(),state.currency)}`:'';
  document.querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>changeCart(b.dataset.dec,-1));document.querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>changeCart(b.dataset.inc,1));
  document.querySelectorAll('[data-cartqty]').forEach(i=>i.onchange=async()=>{state.cart[i.dataset.cartqty]=Math.max(1,Number(i.value)||1);await save();renderAll();});
  document.querySelectorAll('[data-remove-cart]').forEach(b=>b.onclick=async()=>{delete state.cart[b.dataset.removeCart];await save();renderAll();});
}
async function changeCart(id,delta){state.cart[id]=Math.max(0,qty(id)+delta);if(!state.cart[id])delete state.cart[id];await save();renderAll();}
function renderOrders(){
  const orders=state.orders.slice().reverse();$('supply-orders-count').textContent=`${orders.length} saved`;
  $('supply-orders').innerHTML=orders.length?orders.map(o=>`<article class="order-card"><div><div class="module-title"><strong>${esc(o.id)}</strong><span class="pill ${o.status==='received'?'verified':''}">${esc(o.status)}</span></div><div class="meta"><span>${new Date(o.created_at).toLocaleString()}</span><span>${o.lines.length} lines</span><span>${money(o.known_cost_total,o.currency)}</span></div></div><div class="module-actions"><button data-export-order="${esc(o.id)}">Export CSV</button>${o.status!=='received'?`<button class="featured" data-received="${esc(o.id)}">Mark received</button>`:''}</div></article>`).join(''):'<div class="empty">No purchase orders saved yet.</div>';
  document.querySelectorAll('[data-export-order]').forEach(b=>b.onclick=()=>exportOrder(state.orders.find(o=>o.id===b.dataset.exportOrder)));
  document.querySelectorAll('[data-received]').forEach(b=>b.onclick=async()=>{const o=state.orders.find(x=>x.id===b.dataset.received);if(!o)return;o.lines.forEach(l=>{const s=itemState(l.product_id);state.inventory[l.product_id]={...s,on_hand:Number(s.on_hand||0)+Number(l.qty||0)};});o.status='received';o.received_at=new Date().toISOString();await save();renderAll();notify(`Received ${o.id}; on-hand stock has been updated.`);});
}
function csvCell(v){const s=String(v??'');return `"${s.replaceAll('"','""')}"`;}
function exportOrder(o){if(!o)return;const rows=[['Order','Company','Created','Product','Unit','Qty','Supplier','Supplier SKU','Unit cost','Line total'],...o.lines.map(l=>[o.id,o.company_id,o.created_at,l.name,l.unit,l.qty,l.supplier,l.supplier_sku,l.unit_cost??'',l.unit_cost==null?'':Number(l.unit_cost)*l.qty])];const blob=new Blob([rows.map(r=>r.map(csvCell).join(',')).join('\n')],{type:'text/csv'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${o.id}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function createOrder(){const lines=cartLines();if(!lines.length)return notify('Add at least one product before creating a purchase order.',true);const now=new Date();const id=`PO-${now.toISOString().replace(/[-:TZ.]/g,'').slice(0,14)}`;state.orders.push({id,company_id:state.company_id,currency:state.currency,status:'draft',created_at:now.toISOString(),known_cost_total:cartTotal(),lines:lines.map(l=>({product_id:l.product.id,name:l.product.name,unit:l.product.unit,qty:l.qty,supplier:l.supplier||'',supplier_sku:l.supplier_sku||'',unit_cost:l.unit_cost}))});state.cart={};await save();renderAll();notify(`Created draft purchase order ${id}. Export it to CSV to send to the supplier.`);}
async function addLowStock(){let n=0;catalog.products.filter(isLow).forEach(p=>{const s=itemState(p.id),needed=Math.max(1,Number(s.par||0)-Number(s.on_hand||0)+1);state.cart[p.id]=qty(p.id)+needed;n++;});await save();renderAll();notify(n?`Added ${n} low-stock product lines to the purchase order.`:'No products are currently below their reorder point.');}
function renderAll(){renderMetrics();renderProducts();renderKits();renderCart();renderOrders();}
async function init(){
  try{const response=await fetch(chrome.runtime.getURL('titan-modules/cleaning-supply-catalog.json'));catalog=await response.json();if(catalog.schema!=='titan-cleaning-supply-catalog/v1')throw new Error('Cleaning supply catalogue is invalid');const loaded=await getStore();state=loaded.companyState;state.company_id=loaded.company;state.currency=state.currency||catalog.currency_default||'AUD';renderFilters();renderAll();
  }catch(e){notify(`Cleaning supply marketplace unavailable: ${e.message}`,true);}
}
$('supply-search').addEventListener('input',e=>{filters.query=e.target.value;renderProducts();});$('supply-category').addEventListener('change',e=>{filters.category=e.target.value;renderProducts();});$('supply-job').addEventListener('change',e=>{filters.job=e.target.value;renderProducts();});$('supply-low-only').addEventListener('change',e=>{filters.low=e.target.checked;renderProducts();});$('supply-add-low').onclick=()=>addLowStock().catch(e=>notify(e.message,true));$('supply-create-order').onclick=()=>createOrder().catch(e=>notify(e.message,true));$('supply-clear-cart').onclick=async()=>{state.cart={};await save();renderAll();notify('Purchase order cleared.');};
window.addEventListener('titan-company-changed',()=>init());init();
})();
