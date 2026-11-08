// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-builder/interface-lineage/presentation-runtime.mjs
const BREAKPOINTS = Object.freeze({desktop:{columns:12},tablet:{columns:8},mobile:{columns:4}});
const PROFILES = new Set(['inherit','soft','contrast']);

export function normalizeResponsivePresentation(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const out = { profile: PROFILES.has(source.profile) ? source.profile : 'inherit', breakpoints: {} };
  for (const [name, meta] of Object.entries(BREAKPOINTS)) {
    const src = source.breakpoints?.[name] || {};
    const span = Number.isInteger(src.span) ? src.span : meta.columns;
    const order = Number.isInteger(src.order) && src.order >= 0 ? src.order : 0;
    out.breakpoints[name] = {
      visible: src.visible !== false,
      span: Math.min(meta.columns, Math.max(1, span)),
      order,
      density: ['compact','comfortable','spacious'].includes(src.density) ? src.density : 'comfortable'
    };
  }
  return out;
}

export function resolveRuntimePath(payload, runtimePath) {
  if (!runtimePath) return undefined;
  const parts = String(runtimePath).split('.').filter(Boolean);
  let cur = payload;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object' || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function validatePublishedLayout(claim, screenContract, companyId) {
  if (!claim || !screenContract) return {accepted:false, reason:'missing-layout-or-contract'};
  if (!companyId || claim.company_id !== companyId) return {accepted:false, reason:'company-boundary-mismatch'};
  if (claim.screen_key !== screenContract.screen_key) return {accepted:false, reason:'screen-key-mismatch'};
  if (claim.runtime_owner !== screenContract.runtime_owner) return {accepted:false, reason:'runtime-owner-mismatch'};
  const allowed = new Set(screenContract.allowed_components || []);
  for (const component of claim.spec?.components || []) {
    if (!allowed.has(component.type)) return {accepted:false, reason:'component-not-allowed', component:component.type};
    if (component.runtime_path && !String(component.runtime_path).match(/^[A-Za-z0-9_.-]+$/)) {
      return {accepted:false, reason:'unsafe-runtime-path'};
    }
  }
  return {accepted:true, validated_fingerprint:screenContract.fingerprint || null};
}
