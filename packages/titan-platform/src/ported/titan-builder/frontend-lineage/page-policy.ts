// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-builder/frontend-lineage/page-policy.mjs
function requireCompany(input) {
  if (!input?.company_id) throw new Error('company_id_required');
  if (input.tenant_id || input.tenant_company_id) throw new Error('legacy_tenant_boundary_rejected');
}

export function resolvePageSource({ company_id, databasePage = null, themeBlueprint = null } = {}) {
  requireCompany({ company_id });
  if (databasePage) {
    if (databasePage.enabled === false) return { source: 'suppressed', reason: 'disabled_database_page', page: null };
    return { source: 'database', page: databasePage };
  }
  if (themeBlueprint) return { source: 'theme_blueprint', page: themeBlueprint };
  return { source: 'not_found', page: null };
}

export function evaluateMaterializeReset({ company_id, existingPage = null, activeThemeId, sourceThemeId, locallyModified = false, force = false } = {}) {
  requireCompany({ company_id });
  if (!activeThemeId || sourceThemeId !== activeThemeId) return { allowed: false, reason: 'inactive_theme' };
  if (existingPage?.managed_state === 'user-owned') return { allowed: false, reason: 'user_owned_page' };
  if (locallyModified && !force) return { allowed: false, reason: 'local_modifications_require_force' };
  return { allowed: true, reason: existingPage ? 'managed_reset_allowed' : 'materialize_allowed' };
}
