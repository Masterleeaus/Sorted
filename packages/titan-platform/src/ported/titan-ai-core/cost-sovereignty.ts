/**
 * @deprecated Compatibility Cost Sovereignty facade from the Titan AI Core donor.
 * Canonical model/provider/locality/privacy/cost routing lives in
 * packages/titan-platform/src/intelligence-runtime and #647/#1055.
 * Do not add new routing policy here. Migrate consumers, then retain only a
 * compatibility translation/re-export if required.
 */
export type InferenceRoute = "device" | "customer-hosted" | "byo-cloud" | "titan-managed";
export type CostSovereigntyRequest = Readonly<{
  company_id: string;
  allowed_routes?: readonly InferenceRoute[];
  requested_route?: InferenceRoute;
  titan_managed_entitled?: boolean;
  titan_metered_opt_in?: boolean;
  privacy_local_only?: boolean;
}>;

export type CostSovereigntyDecision = Readonly<{
  company_id: string;
  route: InferenceRoute;
  escalation_required: boolean;
  escalation_reason: "none" | "requested-route-unavailable" | "local-only-policy" | "titan-service-not-entitled" | "titan-metered-opt-in-required";
  titan_funded_fallback: false;
  authority_neutral: true;
  execution_authority: false;
}>;

const ROUTES: readonly InferenceRoute[] = ["device","customer-hosted","byo-cloud","titan-managed"];

export function decideInferenceRoute(input: CostSovereigntyRequest): CostSovereigntyDecision {
  const company_id=String(input.company_id??"").trim();
  if(!company_id) throw new Error("company_id-required");
  const allowed=[...(input.allowed_routes??ROUTES)].filter((r): r is InferenceRoute=>ROUTES.includes(r));
  if(allowed.length!==new Set(allowed).size) throw new Error("duplicate-inference-route");
  if(input.privacy_local_only && allowed.some(r=>r==="byo-cloud"||r==="titan-managed")) {
    const localRoute=allowed.find(r=>r==="device")??allowed.find(r=>r==="customer-hosted");
    if(!localRoute) throw new Error("local-only-policy-has-no-local-route");
    return Object.freeze({company_id,route:localRoute,escalation_required:true,escalation_reason:"local-only-policy",titan_funded_fallback:false,authority_neutral:true,execution_authority:false});
  }
  const requested=input.requested_route;
  if(requested && !allowed.includes(requested)) {
    return Object.freeze({company_id,route:allowed[0]??"device",escalation_required:true,escalation_reason:"requested-route-unavailable",titan_funded_fallback:false,authority_neutral:true,execution_authority:false});
  }
  const route=requested??allowed[0]??"device";
  if(route==="titan-managed" && !input.titan_managed_entitled && !input.titan_metered_opt_in) {
    return Object.freeze({company_id,route:allowed.find(r=>r!=="titan-managed")??"device",escalation_required:true,escalation_reason:"titan-service-not-entitled",titan_funded_fallback:false,authority_neutral:true,execution_authority:false});
  }
  return Object.freeze({company_id,route,escalation_required:false,escalation_reason:"none",titan_funded_fallback:false,authority_neutral:true,execution_authority:false});
}

export const COST_SOVEREIGNTY_POLICY=Object.freeze({
  schema:"titan.ai.cost-sovereignty/v1",
  tenant_boundary:"company_id-logical",
  routing_order:Object.freeze(ROUTES),
  hidden_titan_fallback:false,
  authority_neutral:true,
  execution_authority:false,
});
