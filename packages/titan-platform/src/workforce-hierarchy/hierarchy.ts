import hierarchy from "./workforce-hierarchy.json";
export type Position="Orchestrator"|"Manager"|"Specialist"|"Worker";
const rank:Record<Position,number>={Orchestrator:0,Manager:1,Specialist:2,Worker:3};
const nodes=new Map(hierarchy.agents.map(a=>[a.agent_id,a] as const));
export function getHierarchyNode(agent_id:string){const n=nodes.get(String(agent_id??"").trim());if(!n)throw new Error("hierarchy-agent-not-found");return n;}
export function validateDelegationEdge(parent_id:string,child_id:string){
 const p=getHierarchyNode(parent_id),c=getHierarchyNode(child_id);
 if(c.parent_agent_id!==p.agent_id&&!p.child_agent_ids.includes(c.agent_id))throw new Error("delegation-edge-not-canonical");
 if(rank[p.position as Position]>=rank[c.position as Position])throw new Error("delegation-tier-direction-invalid");
 return Object.freeze({schema:"titan.workforce.delegation-edge.v1",parent_agent_id:p.agent_id,child_agent_id:c.agent_id,
 hierarchy_valid:true,authority_granted:false as const,execution_permitted:false as const,grants_authority:false as const,authority_effect:false as const});
}
export function delegationChain(agent_id:string){
 const chain:string[]=[];let n:any=getHierarchyNode(agent_id);const seen=new Set<string>();
 while(n){if(seen.has(n.agent_id))throw new Error("hierarchy-cycle");seen.add(n.agent_id);chain.unshift(n.agent_id);n=n.parent_agent_id?getHierarchyNode(n.parent_agent_id):null;}
 return Object.freeze(chain);
}
