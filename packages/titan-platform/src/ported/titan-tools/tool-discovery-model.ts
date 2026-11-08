// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-tools/tool-discovery-model.mjs
const norm = v => String(v ?? '').trim();
const lc = v => norm(v).toLowerCase();

export function favoriteStorageKey(companyId){
  const id = norm(companyId || 'unscoped').replace(/[^a-zA-Z0-9._-]/g,'_');
  return `titan.tools.favourites.${id}`;
}
export function recentStorageKey(companyId){
  const id = norm(companyId || 'unscoped').replace(/[^a-zA-Z0-9._-]/g,'_');
  return `titan.tools.recent.${id}`;
}

export function buildDiscoveryIndex(tools=[], routes={}){
  return tools.map(tool => {
    const tool_id = norm(tool.tool_id);
    const route = routes?.[tool_id] || {};
    const searchBits = [
      tool_id, tool.name, tool.category, tool.cleaning_relevance,
      ...(tool.cleaning_use_cases||[]), ...(tool.supported_roles||[])
    ].map(norm).filter(Boolean);
    return {
      tool_id,
      title: norm(tool.name || tool_id),
      category: norm(tool.category || 'Other'),
      cleaning_relevance: norm(tool.cleaning_relevance || 'general'),
      cleaning_use_cases: Array.isArray(tool.cleaning_use_cases) ? tool.cleaning_use_cases : [],
      supported_roles: Array.isArray(tool.supported_roles) ? tool.supported_roles : [],
      surface: norm(route.surface || tool.launch_surface || 'ai_workspace'),
      launch: route,
      searchable: lc(searchBits.join(' '))
    };
  }).filter(x => x.tool_id);
}

export function searchTools(index=[], query='', category='all'){
  const q = lc(query);
  const cat = lc(category);
  return index.filter(item => {
    if(cat && cat !== 'all' && lc(item.category) !== cat) return false;
    if(!q) return true;
    return item.searchable.includes(q) || q.split(/\s+/).filter(Boolean).every(t => item.searchable.includes(t));
  }).sort((a,b) => {
    const rel = {high:0,medium:1,general:2,low:3};
    return (rel[lc(a.cleaning_relevance)] ?? 9) - (rel[lc(b.cleaning_relevance)] ?? 9) || a.title.localeCompare(b.title);
  });
}

export function categoryCounts(index=[]){
  return index.reduce((acc,item)=>{ acc[item.category]=(acc[item.category]||0)+1; return acc; },{});
}

export function launchTargetFor(item){
  const route = item?.launch || {};
  if(route.surface === 'page_context') return {kind:'page_context', tool_id:item.tool_id};
  if(route.surface === 'retriever_runtime') return {kind:'retriever', url: route.entrypoint || 'side-panel/index.html'};
  if(route.surface === 'ai_workspace') return {kind:'workspace', url: route.launch_url || route.entrypoint || 'chatTab.html'};
  return {kind:'workspace', url: route.launch_url || route.entrypoint || 'chatTab.html'};
}
