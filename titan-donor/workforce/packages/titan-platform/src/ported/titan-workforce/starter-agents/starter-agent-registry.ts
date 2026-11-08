// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/starter-agent-registry.mjs
import registry from './starter-agent-registry.json' with { type: 'json' };
export const STARTER_AGENT_REGISTRY=Object.freeze(registry);
export function listStarterAgents(){return registry.agents.map(x=>({...x,operational_domains:[...x.operational_domains]}));}
export function getStarterAgent(key){const k=String(key||'').trim().toLowerCase();return listStarterAgents().find(x=>x.agent_key===k)||null;}
export function assertStarterAgentCompany(input={}){const id=String(input.company_id||'').trim();if(!id)throw new Error('company_id-required');return id;}
