// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-local/kernel/module-runtime.mjs
import {assertExecutionAuthority} from '../../titan-modules/authority.js';
import {normalizeCompanyContext,assertContractCompany} from './company-context.js';
import {normalizeLocalModuleContract} from './module-contract.js';
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

export function createLocalModuleRuntime(rawContract,handlers={}){
  const contract=normalizeLocalModuleContract(rawContract);
  const commandDefs=new Map(contract.commands.map(item=>[item.id,item]));
  const queryDefs=new Map(contract.queries.map(item=>[item.id,item]));
  const commandHandlers=handlers.commands&&typeof handlers.commands==='object'?handlers.commands:{};
  const queryHandlers=handlers.queries&&typeof handlers.queries==='object'?handlers.queries:{};
  const emitter=typeof handlers.emit==='function'?handlers.emit:null;
  const contextFor=raw=>{const ctx=normalizeCompanyContext(raw);assertContractCompany(contract.company_id,ctx);return ctx;};
  return Object.freeze({
    contract,
    async command(commandId,payload={},rawContext={}){
      const id=String(commandId||'').trim().toLowerCase();const def=commandDefs.get(id);if(!def)throw new Error(`Unknown command: ${commandId}`);
      const fn=commandHandlers[id];if(typeof fn!=='function')throw new Error(`Command handler unavailable: ${id}`);
      const context=contextFor(rawContext);assertExecutionAuthority(def,context);
      return clone(await fn({payload:clone(payload),context,contract}));
    },
    async query(queryId,payload={},rawContext={}){
      const id=String(queryId||'').trim().toLowerCase();const def=queryDefs.get(id);if(!def)throw new Error(`Unknown query: ${queryId}`);
      const fn=queryHandlers[id];if(typeof fn!=='function')throw new Error(`Query handler unavailable: ${id}`);
      const context=contextFor(rawContext);return clone(await fn({payload:clone(payload),context,contract}));
    },
    async emit(type,payload={},rawContext={}){
      const eventType=String(type||'').trim().toLowerCase();if(!contract.events.includes(eventType))throw new Error(`Unknown event: ${type}`);
      if(!emitter)throw new Error('Event emitter unavailable');const context=contextFor(rawContext);
      const event={event_id:globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`,type:eventType,module_id:contract.module_id,company_id:context.company_id,occurred_at:new Date().toISOString(),payload:clone(payload)};
      await emitter(clone(event));return clone(event);
    },
  });
}
