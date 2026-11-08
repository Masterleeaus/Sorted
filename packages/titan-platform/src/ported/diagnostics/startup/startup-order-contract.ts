// @ts-nocheck
// Ported from Titan Zero extension (portable-core): diagnostics/startup/startup-order-contract.mjs
export const TITAN_BACKGROUND_STARTUP_IMPORT_ORDER = Object.freeze([
  './titan-modules/module-host.js',
  './titan-local/storage/bootstrap.js',
  './runtime/native-runtime-background.js',
  './runtime/workforce-runtime-background.js',
  './titan-runtime/page-context-rehydration.js',
]);

export const TITAN_BACKGROUND_STARTUP_DEPENDENCIES = Object.freeze({
  './runtime/native-runtime-background.js': Object.freeze(['../titan-local/storage/bootstrap.js']),
  './runtime/workforce-runtime-background.js': Object.freeze(['../titan-local/storage/bootstrap.js']),
});

export function extractStaticSideEffectImports(source='') {
  const text=String(source||'');
  const imports=[];
  const pattern=/^\s*import\s+['"]([^'"]+)['"]\s*;?/gm;
  let match;
  while((match=pattern.exec(text))) imports.push(match[1]);
  return imports;
}

export function extractStaticImports(source='') {
  const text=String(source||'');
  const imports=[];
  const pattern=/^\s*import(?:[\s\S]*?\sfrom\s*)?['"]([^'"]+)['"]\s*;?/gm;
  let match;
  while((match=pattern.exec(text))) imports.push(match[1]);
  return imports;
}

export function evaluateBackgroundStartupOrder({bootstrapSource='',moduleSources={}}={}) {
  const observed=extractStaticSideEffectImports(bootstrapSource);
  const expected=[...TITAN_BACKGROUND_STARTUP_IMPORT_ORDER];
  const relevantObserved=observed.filter(item=>expected.includes(item));
  const blockers=[];
  if(relevantObserved.length!==expected.length || relevantObserved.some((item,index)=>item!==expected[index])) {
    blockers.push({code:'background_startup_import_order_changed',expected,observed:relevantObserved});
  }
  for(const [modulePath,dependencies] of Object.entries(TITAN_BACKGROUND_STARTUP_DEPENDENCIES)) {
    const source=moduleSources[modulePath];
    if(typeof source!=='string') {
      blockers.push({code:'startup_module_source_missing',module:modulePath});
      continue;
    }
    const imports=extractStaticImports(source);
    for(const dependency of dependencies) {
      if(!imports.includes(dependency)) blockers.push({code:'startup_dependency_missing',module:modulePath,dependency});
    }
  }
  return Object.freeze({
    schema:'titan.zero.startup.order.assertion.v1',
    expected_import_order:Object.freeze(expected),
    observed_import_order:Object.freeze(relevantObserved),
    dependency_assertions:Object.freeze(Object.entries(TITAN_BACKGROUND_STARTUP_DEPENDENCIES).map(([module,dependencies])=>Object.freeze({module,dependencies}))),
    blockers:Object.freeze(blockers),
    ok:blockers.length===0,
    authority_effect:false,
    grants_authority:false,
  });
}
