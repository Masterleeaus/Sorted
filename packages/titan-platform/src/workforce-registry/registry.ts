import registry from "./workforce-runtime-registry.json";
export type CanonicalSurface="zero"|"go"|"hub";
export type WorkforcePosition="Orchestrator"|"Manager"|"Specialist"|"Worker";
export type RuntimeAgent=(typeof registry.agents)[number];
const byId=new Map(registry.agents.map(a=>[a.agent_id,a] as const));
export function getRuntimeAgent(agent_id:string):RuntimeAgent{
 const a=byId.get(String(agent_id??"").trim()); if(!a)throw new Error("workforce-agent-not-found"); return a;
}
export function listRuntimeAgents():readonly RuntimeAgent[]{return registry.agents;}
export function assertCompanyBoundary(company_id:string){const v=String(company_id??"").trim();if(!v)throw new Error("company_id-required");return v;}
export const WORKFORCE_RUNTIME_REGISTRY=registry;
