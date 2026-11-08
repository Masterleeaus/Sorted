// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/hierarchy/workforce-organizational-graph.mjs
import graph from './workforce-organizational-graph.json' with { type: 'json' };
export const workforceOrganizationalGraph=graph;
export const roleNode=(id)=>graph.catalogue_hierarchy.find(x=>x.role_definition_id===id)||graph.atomic_workers.find(x=>x.worker_id===id)||null;
export const tier=(name)=> name==='orchestrator'?graph.orchestrators: name==='worker'?graph.atomic_workers:graph.catalogue_hierarchy.filter(x=>x.workforce_tier===name);
export default graph;
