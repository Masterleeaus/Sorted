// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/builtin/module-health/index.mjs
export async function activate(api, manifest) {
  api.registerHandler('ping', async payload => ({
    ok: true,
    module: manifest.id,
    version: manifest.version,
    echo: payload ?? null,
    at: new Date().toISOString(),
  }));
  api.registerTool('probe', async (payload, context) => ({
    ok:true,
    module:manifest.id,
    version:manifest.version,
    company_id:context?.company_id ?? null,
    payload:payload ?? null,
    at:new Date().toISOString(),
  }));
  api.registerProvider('echo-provider', async payload => ({...(payload && typeof payload==='object' ? payload : {value:payload}), provider:'echo-provider'}));
  api.registerProjection('health', async context => ({ok:true,module:manifest.id,version:manifest.version,company_id:context?.company_id ?? null,status:'active'}));
  api.registerDiagnostic('activation', async () => ({ok:true, message:'Packaged module activated', contributions:Object.fromEntries(Object.entries(manifest.contributes||{}).map(([key,value])=>[key,Array.isArray(value)?value.length:0]))}));
  api.log('info', 'Module Health activated');
  return () => api.log('info', 'Module Health deactivated');
}
