// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter-agents/sales/runtime/sales-settings-policy.mjs
import { normalizeSalesSettings } from './sales-agent-contract.js';

export const SALES_SETTINGS_POLICY_SCHEMA = 'titan-zero-starter-sales-settings-policy/v1';
const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
function rejectLegacy(input) {
  if (!input || typeof input !== 'object') return;
  if ('tenant_id' in input || 'tenant_company_id' in input) throw new TypeError('legacy tenant boundaries are not accepted by Sales settings');
}

export function projectSalesSettings(input = {}) {
  rejectLegacy(input);
  rejectLegacy(input.settings_snapshot);
  const companyId = clean(input.company_id);
  if (!companyId) throw new TypeError('company_id is required');
  const snapshot = input.settings_snapshot;
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('settings_snapshot is required');
  if (clean(snapshot.company_id) !== companyId) throw new TypeError('cross-company settings snapshot rejected');
  if (snapshot.canonical_settings_projection !== true) throw new TypeError('settings_snapshot must be a canonical Titan settings projection');
  if (!clean(snapshot.revision)) throw new TypeError('settings_snapshot.revision is required');

  const settings = normalizeSalesSettings(snapshot.sales ?? {});
  const discount = Object.freeze({
    mode: settings.discount_authority,
    approval_required: settings.discount_authority === 'external_approval_required',
    authority_ref: clean(snapshot.sales?.discount_authority_ref),
    execution_authority: false
  });
  if (discount.mode === 'external_approval_required' && !discount.authority_ref) {
    throw new TypeError('external discount approval requires discount_authority_ref');
  }

  return Object.freeze({
    schema: SALES_SETTINGS_POLICY_SCHEMA,
    company_id: companyId,
    source: Object.freeze({ owner: 'Titan Settings', revision: clean(snapshot.revision), canonical_projection: true }),
    qualification: Object.freeze({
      strictness: settings.qualification_strictness,
      require_service_fit_before_handoff: settings.require_service_fit_before_handoff,
      require_location_fit_before_handoff: settings.require_location_fit_before_handoff,
      low_confidence_threshold: settings.low_confidence_threshold,
      handoff_confidence_threshold: settings.handoff_confidence_threshold
    }),
    follow_up: Object.freeze({
      max_touches: settings.max_follow_up_touches,
      cadence_hours: Object.freeze([...settings.follow_up_cadence_hours]),
      quiet_hours: Object.freeze({ ...settings.quiet_hours })
    }),
    target_services: Object.freeze([...settings.target_services]),
    territory: Object.freeze({ policy_ref: settings.territory_policy_ref, reference_only: true }),
    conversion_goals: settings.conversion_goals,
    escalation: settings.escalation,
    discount,
    controls: Object.freeze({
      shared_settings_registry_modified: false,
      settings_authority_created: false,
      territory_authority_created: false,
      service_catalogue_authority_created: false,
      conversion_goals_are_advisory: true,
      discount_setting_grants_authority: false,
      persistence_performed: false
    }),
    authority_neutral: true,
    execution_authority: false
  });
}
