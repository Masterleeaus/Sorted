import type { InterfaceContext } from "../interface-runtime.js";
import type { BuilderProjectionProvider, BuilderProjectionRequest } from "./runtime-projection.js";
import type { BuilderRuntimePreviewEnvelope } from "./preview-adapter.js";

export type BuilderProjectionOwner="workcore"|"titan-money";
export type BuilderCapabilityProjectionQuery=Readonly<{
  company_id:string;
  surface:"zero"|"go"|"hub";
  source:string;
  contract:string;
  fields:readonly string[];
  capability:string;
  purpose:"builder-preview";
  read_only:true;
}>;
export type BuilderCapabilityProjectionResult=Readonly<{
  company_id:string;
  records:readonly Readonly<Record<string,unknown>>[];
}>;
export type BuilderCapabilityProjectionExecutor=(query:BuilderCapabilityProjectionQuery,context:InterfaceContext)=>Promise<BuilderCapabilityProjectionResult|null>|BuilderCapabilityProjectionResult|null;
export type BuilderProjectionExecutors=Readonly<{
  workcore?:BuilderCapabilityProjectionExecutor;
  titanMoney?:BuilderCapabilityProjectionExecutor;
}>;

const MONEY_CONTRACTS=new Set([
  "crm.customer.invoices",
  "crm.customer.quotes",
  "crm.owner.finance-summary",
]);
const WORKCORE_PREFIXES=[
  "crm.business.",
  "crm.customer.bookings",
  "crm.customer.work-orders",
  "crm.field.",
  "crm.owner.approvals",
  "crm.owner.operations-summary",
  "crm.owner.schedule-capacity",
];

/** Canonical read owner for Builder projection contracts. Builder never owns these records. */
export function builderProjectionOwner(contract:string):BuilderProjectionOwner|null{
  if(MONEY_CONTRACTS.has(contract))return "titan-money";
  if(WORKCORE_PREFIXES.some(prefix=>contract.startsWith(prefix)))return "workcore";
  return null;
}

function executorFor(owner:BuilderProjectionOwner,executors:BuilderProjectionExecutors){
  return owner==="titan-money"?executors.titanMoney:executors.workcore;
}

/**
 * Creates the host-runtime provider used by Builder preview. It delegates only to the
 * canonical capability owner, forwards an exact field allowlist, and rejects identity drift.
 */
export function createCapabilityOwnedBuilderProjectionProvider(executors:BuilderProjectionExecutors):BuilderProjectionProvider{
  return async (request:BuilderProjectionRequest,context:InterfaceContext):Promise<BuilderRuntimePreviewEnvelope|null>=>{
    if(request.company_id!==context.company_id)throw new Error("builder_projection_provider_company_mismatch");
    if(request.surface!==context.product_surface)throw new Error("builder_projection_provider_surface_mismatch");
    if(!request.required_capability)throw new Error(`builder_projection_capability_required:${request.source}`);
    const owner=builderProjectionOwner(request.contract);
    if(!owner)throw new Error(`builder_projection_owner_unknown:${request.contract}`);
    const executor=executorFor(owner,executors);
    if(!executor)return null;
    const result=await executor(Object.freeze({
      company_id:request.company_id,
      surface:request.surface,
      source:request.source,
      contract:request.contract,
      fields:Object.freeze([...request.fields]),
      capability:request.required_capability,
      purpose:"builder-preview" as const,
      read_only:true as const,
    }),context);
    if(!result)return null;
    if(result.company_id!==request.company_id)throw new Error("builder_projection_executor_company_mismatch");
    return Object.freeze({company_id:request.company_id,surface:request.surface,source:request.source,records:Object.freeze(result.records.slice(0,6)),received_at:new Date().toISOString()});
  };
}

/** Convenience owner-specific provider for WorkCore customer/job/schedule projections. */
export function createWorkCoreBuilderProjectionProvider(executor:BuilderCapabilityProjectionExecutor):BuilderProjectionProvider{
  return createCapabilityOwnedBuilderProjectionProvider({workcore:executor});
}

/** Convenience owner-specific provider for Titan Money quote/invoice/finance projections. */
export function createTitanMoneyBuilderProjectionProvider(executor:BuilderCapabilityProjectionExecutor):BuilderProjectionProvider{
  return createCapabilityOwnedBuilderProjectionProvider({titanMoney:executor});
}
