// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/diagnostic-retention.js
(()=>{
  const DEFAULT_MAX_ENTRIES=1000;
  const asText=value=>value==null?null:String(value).trim()||null;
  const timestamp=value=>{
    const parsed=Date.parse(String(value||''));
    return Number.isFinite(parsed)?new Date(parsed).toISOString():new Date().toISOString();
  };
  function normalizeDiagnosticEntry(entry={}){
    const detail=entry?.detail&&typeof entry.detail==='object'&&!Array.isArray(entry.detail)?entry.detail:{};
    return {
      ...entry,
      ts:timestamp(entry.ts),
      level:asText(entry.level)||'info',
      source:asText(entry.source)||'unknown',
      message:asText(entry.message)||'',
      correlation_id:asText(entry.correlation_id)||asText(detail.correlation_id),
      operation_id:asText(entry.operation_id)||asText(detail.operation_id),
      detail,
    };
  }
  function pruneDiagnosticLog(log,{maxEntries=DEFAULT_MAX_ENTRIES}={}){
    const max=Math.max(1,Number(maxEntries)||DEFAULT_MAX_ENTRIES);
    const normalized=(Array.isArray(log)?log:[]).map(normalizeDiagnosticEntry);
    const pruned=Math.max(0,normalized.length-max);
    const entries=normalized.slice(-max);
    return Object.freeze({entries:Object.freeze(entries),pruned,maxEntries:max,inputCount:normalized.length});
  }
  function appendDiagnosticEntry(log,entry,options={}){
    return pruneDiagnosticLog([...(Array.isArray(log)?log:[]),normalizeDiagnosticEntry(entry)],options);
  }
  globalThis.TitanDiagnosticRetention=Object.freeze({DEFAULT_MAX_ENTRIES,normalizeDiagnosticEntry,pruneDiagnosticLog,appendDiagnosticEntry});
})();
