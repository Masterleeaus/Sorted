// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interface-runtime/workspace.mjs
import { hasInterfaceCapabilities } from './context.js';

export function composeObjectWorkspace(reference, context, { objectRegistry, facetRegistry } = {}) {
  if (!objectRegistry || typeof objectRegistry.resolve !== 'function') throw new TypeError('objectRegistry.resolve is required');
  if (!facetRegistry || typeof facetRegistry.forObject !== 'function') throw new TypeError('facetRegistry.forObject is required');
  const resolved = objectRegistry.resolve(reference, context);
  const object = resolved?.object;
  if (!object || typeof object !== 'object') throw new TypeError('object registry did not resolve an object');
  const required = Array.isArray(object.permissions) ? object.permissions : [];
  if (!hasInterfaceCapabilities(context, required)) throw new Error(`Object '${String(object.key ?? 'unknown')}' is not authorized in the current interface context.`);
  const facets = (facetRegistry.forObject(object.key, context) ?? []).map((facet) => Object.freeze({ ...facet }));
  return Object.freeze({
    schema:'titan.object-workspace.v1',
    company_id:context.company_id,
    object:resolved,
    product_surface:context.product_surface,
    facet_loading:'lazy',
    facets:Object.freeze(facets),
    authority_neutral:true,
    composition_grants_authority:false,
  });
}
