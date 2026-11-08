import type { InterfaceWorkspace } from "./interface-workspace.js";
import { createActionIntent } from "./interface-workspace.js";
import { createInteractionContext } from "./ported/titan-runtime/interaction-engine/contracts.js";

type R=Readonly<Record<string,unknown>>;
export type GovernedInteractionHandoff=Readonly<{schema:"titan.interface-interaction-handoff.v1";company_id:string;surface:string;interaction_context:R;action_intent:R;route:Readonly<{engine:"interaction-engine";mode:"governed-intent";capability_ref:string|null;interaction:R|null}>;authority:"intent-only";executable:false}>;
const legacy=(x:R)=>"tenant_id" in x||"tenant_company_id" in x;
export function createGovernedInteractionHandoff(workspace:InterfaceWorkspace,objectKey:string,actionKey:string,payload:R={},context:R={}):GovernedInteractionHandoff{
 if(legacy(payload)||legacy(context))throw new Error("legacy tenant authority rejected");
 const intent=createActionIntent(workspace,objectKey,actionKey,payload) as R;
 if(intent.company_id!==workspace.company_id)throw new Error("company boundary mismatch");
 const mutating=workspace.objects.find(o=>o.key===objectKey)?.actions.find(a=>a.key===actionKey)?.mutating===true;
 if(mutating&&!intent.capability_ref&&!intent.interaction)throw new Error("mutating action requires governed route");
 const interaction_context=createInteractionContext({...context,company_id:workspace.company_id,surface:workspace.surface});
 return Object.freeze({schema:"titan.interface-interaction-handoff.v1",company_id:workspace.company_id,surface:workspace.surface,interaction_context,action_intent:intent,route:Object.freeze({engine:"interaction-engine",mode:"governed-intent",capability_ref:intent.capability_ref==null?null:String(intent.capability_ref),interaction:intent.interaction&&typeof intent.interaction==="object"?intent.interaction as R:null}),authority:"intent-only",executable:false});
}
export function assertInteractionEngineResultBoundary(handoff:GovernedInteractionHandoff,result:R){
 if(legacy(result))throw new Error("legacy tenant authority rejected");
 if(String(result.company_id??"")!==handoff.company_id)throw new Error("interaction result company boundary mismatch");
 if(result.direct_effect===true||result.interface_executed===true)throw new Error("interface runtime cannot accept direct execution authority");
 return Object.freeze({...result,company_id:handoff.company_id,surface:handoff.surface,received_by:"interface-runtime",execution_authority:false});
}
