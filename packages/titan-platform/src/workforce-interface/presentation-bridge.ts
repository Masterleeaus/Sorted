import {createWorkforceInteractionIntent} from "./interaction-adapter.js";
import {createWorkforceGenerativeUI} from "./interface-adapter.js";
import type {WorkforcePresentationInput} from "./contracts.js";
/** Bridge only: Interaction Engine owns meaning; Interface Runtime owns composition. */
export function createWorkforcePresentationBridge(input:WorkforcePresentationInput){
 const interaction=createWorkforceInteractionIntent(input);
 const presentation=createWorkforceGenerativeUI(input);
 if(interaction.company_id!==presentation.company_id||interaction.agent_id!==presentation.agent_id)throw new Error("workforce-presentation-lineage-mismatch");
 return Object.freeze({schema:"titan.workforce.presentation-bridge.v1",company_id:interaction.company_id,agent_id:interaction.agent_id,
 surface:interaction.surface,interaction,presentation,interaction_engine_owns_meaning:true,interface_runtime_owns_presentation:true,
 workforce_identity_owns_neither_execution_authority_nor_surface_identity:true,authority_granted:false as const,execution_permitted:false as const});
}
