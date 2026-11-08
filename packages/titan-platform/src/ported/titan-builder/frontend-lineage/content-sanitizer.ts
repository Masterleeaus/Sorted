// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-builder/frontend-lineage/content-sanitizer.mjs
const DENIED_KEY = /(api[_-]?key|secret|password|token|credential|private[_-]?key|client[_-]?secret|payment[_-]?secret|authorization|cookie)/i;

export function sanitizePublicProjection(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicProjection);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (DENIED_KEY.test(key)) continue;
    out[key] = sanitizePublicProjection(child);
  }
  return out;
}
