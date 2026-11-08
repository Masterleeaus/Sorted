export const TITAN_WORKFORCE_HIERARCHY_SCHEMA = "titan.workforce.hierarchy.v1" as const;

export const TITAN_WORKFORCE_HIERARCHY_TIERS = [
  "manager",
  "supervisor",
  "agent",
  "worker",
] as const;

export type TitanWorkforceHierarchyTier = (typeof TITAN_WORKFORCE_HIERARCHY_TIERS)[number];

export type TitanWorkforceHierarchyNode = {
  companyId: string;
  tier: TitanWorkforceHierarchyTier;
  id: string;
  parentId?: string | null;
  sourceKind: "native_agent" | "workforce_role" | "atomic_worker";
  sourceId: string;
};

export type TitanWorkforceHierarchyContract = {
  schema: typeof TITAN_WORKFORCE_HIERARCHY_SCHEMA;
  companyBoundary: "company_id";
  tiers: readonly TitanWorkforceHierarchyTier[];
  executionLayer: "tool_capability";
  businessTruthAuthority: "existing_business_ops_routes_and_domain_services";
  authority: {
    identityConfersAuthority: false;
    hierarchyConfersAuthority: false;
    parentageConfersAuthority: false;
    delegationConfersAuthority: false;
    decisionRightsConferExecutionAuthority: false;
    executionRequiresAuthorityEvaluation: true;
    executionRequiresCapabilityResolution: true;
  };
  compatibility: {
    canonicalWorkforceGraphIsDerived: true;
    existingManagerSupervisorRuntimeReused: true;
    existingDelegationRuntimeReused: true;
    existingAtomicWorkerBindingsReused: true;
    existingCommandGatewayRemainsAuthoritative: true;
    portedFiveTierGraphRemainsDonorEvidence: true;
  };
};

export const TITAN_WORKFORCE_HIERARCHY_CONTRACT: TitanWorkforceHierarchyContract = Object.freeze({
  schema: TITAN_WORKFORCE_HIERARCHY_SCHEMA,
  companyBoundary: "company_id",
  tiers: TITAN_WORKFORCE_HIERARCHY_TIERS,
  executionLayer: "tool_capability",
  businessTruthAuthority: "existing_business_ops_routes_and_domain_services",
  authority: Object.freeze({
    identityConfersAuthority: false,
    hierarchyConfersAuthority: false,
    parentageConfersAuthority: false,
    delegationConfersAuthority: false,
    decisionRightsConferExecutionAuthority: false,
    executionRequiresAuthorityEvaluation: true,
    executionRequiresCapabilityResolution: true,
  }),
  compatibility: Object.freeze({
    canonicalWorkforceGraphIsDerived: true,
    existingManagerSupervisorRuntimeReused: true,
    existingDelegationRuntimeReused: true,
    existingAtomicWorkerBindingsReused: true,
    existingCommandGatewayRemainsAuthoritative: true,
    portedFiveTierGraphRemainsDonorEvidence: true,
  }),
});

const COMPANY_ID_PATTERN = /^[A-Za-z0-9._:-]{2,128}$/;

export function assertTitanWorkforceCompanyId(companyId: string): string {
  const normalized = String(companyId ?? "").trim();
  if (!COMPANY_ID_PATTERN.test(normalized)) {
    throw new Error("workforce-hierarchy-company_id-required");
  }
  return normalized;
}

export function isTitanWorkforceHierarchyTier(value: unknown): value is TitanWorkforceHierarchyTier {
  return TITAN_WORKFORCE_HIERARCHY_TIERS.includes(value as TitanWorkforceHierarchyTier);
}

export function validateTitanWorkforceHierarchyNode(node: TitanWorkforceHierarchyNode) {
  const errors: string[] = [];
  try {
    assertTitanWorkforceCompanyId(node.companyId);
  } catch {
    errors.push("invalid-company_id");
  }
  if (!isTitanWorkforceHierarchyTier(node.tier)) errors.push("invalid-tier");
  if (!String(node.id ?? "").trim()) errors.push("missing-id");
  if (!String(node.sourceId ?? "").trim()) errors.push("missing-source-id");
  if (!["native_agent", "workforce_role", "atomic_worker"].includes(node.sourceKind)) {
    errors.push("invalid-source-kind");
  }
  return { ok: errors.length === 0, errors } as const;
}
