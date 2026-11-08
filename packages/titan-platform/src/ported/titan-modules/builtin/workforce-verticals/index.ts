// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/builtin/workforce-verticals/index.mjs
export async function activate(api, manifest) {
  const verticals=manifest.contributes?.verticals||[];
  const workers=manifest.contributes?.workers||[];
  api.registerHandler('summary',async()=>({ok:true,module:manifest.id,verticals:verticals.length,verticalWorkers:workers.length,sharedAgentsInternal:true}));
  api.registerProjection('summary',async context=>({ok:true,module:manifest.id,company_id:context?.company_id??null,verticals:verticals.length,verticalWorkers:workers.length,sharedAgentsInternal:true}));
  api.registerDiagnostic('vertical-boundary',async()=>({ok:true,verticals:verticals.length,verticalWorkers:workers.length,sharedAgentsInternal:true,companyBoundary:'company_id'}));
  api.log('info','Workforce Verticals activated',{verticals:verticals.length,workers:workers.length});
  return ()=>api.log('info','Workforce Verticals deactivated');
}
