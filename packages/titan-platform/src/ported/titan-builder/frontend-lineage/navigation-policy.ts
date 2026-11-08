// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-builder/frontend-lineage/navigation-policy.mjs
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);
function safeHref(href) {
  if (!href) return false;
  if (href.startsWith('/') || href.startsWith('#')) return true;
  try { return SAFE_SCHEMES.has(new URL(href).protocol); } catch { return false; }
}
function validate(items = []) {
  return items.every(i => i && typeof i.label === 'string' && safeHref(i.href));
}
export function resolveNavigation({ userMenu = [], themeMenu = [], platformFallback = [] } = {}) {
  for (const [source, items] of [['user', userMenu], ['theme', themeMenu], ['platform', platformFallback]]) {
    if (!items.length) continue;
    if (!validate(items)) return { source: 'rejected', items: [], reason: `unsafe_${source}_navigation` };
    return { source, items };
  }
  return { source: 'empty', items: [] };
}
