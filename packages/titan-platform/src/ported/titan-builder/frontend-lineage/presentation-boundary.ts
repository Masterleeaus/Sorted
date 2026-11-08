// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-builder/frontend-lineage/presentation-boundary.mjs
export const FRONTEND_PRESENTATION_BOUNDARY = Object.freeze({
  schema: 'titan.builder.public-site-boundary/v1',
  companyBoundary: 'company_id',
  publicSiteRuntimeOwner: 'external_frontend_host',
  presentationAuthoringOwner: 'titan_builder',
  internalExtensionRuntimeOwner: 'titan_interface_runtime',
  internalExtensionScreens: false,
  builderMayAuthor: true,
  builderMayPublishPresentation: true,
  builderMayExecutePublicCmsMutation: false,
  interfaceRuntimeMayRenderPublicWebsite: false,
  registrationConfersAuthority: false,
});

export function assertPublicSiteBoundary(input = {}) {
  if (!input.company_id) throw new Error('company_id_required');
  if (input.tenant_id || input.tenant_company_id) throw new Error('legacy_tenant_boundary_rejected');
  return { ...FRONTEND_PRESENTATION_BOUNDARY, company_id: input.company_id };
}
