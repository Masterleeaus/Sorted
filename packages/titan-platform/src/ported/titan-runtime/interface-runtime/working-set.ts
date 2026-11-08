// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interface-runtime/working-set.mjs
import { deriveInterfaceContext, hasInterfaceCapability } from './context.js';

const SAFE_META = new Set(['source','slug','path','url','mime','size','filename']);
function sanitizeMeta(meta = {}) {
  const out = {};
  for (const [key, value] of Object.entries(meta ?? {})) {
    if (!SAFE_META.has(key) || value == null || value === '') continue;
    const text = String(value);
    if (text.length > 512) continue;
    if ((key === 'url' || key === 'path') && /^(?:javascript|data|file):/i.test(text)) continue;
    out[key] = text;
  }
  return Object.freeze(out);
}

function labelFor(item) {
  const title = String(item.title ?? '').trim();
  if (title) return title;
  return String(item.item_type ?? '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function composeWorkingSetWorkspace(source = {}, context, options = {}) {
  if (String(source.owner_user_id ?? '') !== String(context?.user_id ?? '')) {
    throw new Error('Working set user identity does not match the authenticated interface user.');
  }
  const sourceCompany = source?.context?.business_id ?? source?.context?.company_id ?? null;
  if (sourceCompany != null && String(sourceCompany) !== '' && String(sourceCompany) !== String(context?.company_id ?? '')) {
    throw new Error('Working set company context does not match the authenticated interface company context.');
  }
  const workingSetId = String(source.working_set_id ?? '').trim();
  if (!workingSetId) throw new TypeError('working_set_id is required');
  const child = deriveInterfaceContext(context, { workspace_id: workingSetId });
  const userScoped = new Set(options.user_scoped_types ?? []);
  const typeMap = options.object_type_map ?? {};
  const maxItems = Math.max(1, Math.min(500, Number(options.max_items ?? 200)));
  const items = [];
  const objectRefs = [];
  const opaqueRefs = [];
  const omitted = { unauthorized: 0, unmapped: 0, invalid: 0, truncated: 0 };

  for (const item of (Array.isArray(source.items) ? source.items : []).slice(0, maxItems)) {
    const itemType = String(item.item_type ?? '');
    const itemId = String(item.item_id ?? '');
    if (!itemType || !itemId || /[\x00-\x1F\x7F]/.test(itemType + itemId)) { omitted.invalid++; continue; }
    let objectRef = null;
    if (userScoped.has(itemType)) {
      opaqueRefs.push(`${itemType}:${itemId}`);
    } else {
      const mapping = typeMap[itemType];
      if (!mapping) { omitted.unmapped++; continue; }
      if (mapping.required_capability && !hasInterfaceCapability(child, mapping.required_capability)) { omitted.unauthorized++; continue; }
      const objectKey = String(mapping.object_key ?? '').trim();
      if (!objectKey) { omitted.invalid++; continue; }
      objectRef = `${objectKey}:${child.company_id}:${itemId}`;
      objectRefs.push(objectRef);
    }
    items.push(Object.freeze({
      membership_id: String(item.membership_id ?? ''), item_type: itemType, item_id: itemId,
      label: labelFor(item), object_ref: objectRef, meta: sanitizeMeta(item.meta), updated_at: item.updated_at ?? null,
    }));
  }
  const sourceItems = Array.isArray(source.items) ? source.items : [];
  if (sourceItems.length > maxItems) omitted.truncated = sourceItems.length - maxItems;

  const actionIntents = items.map((item) => Object.freeze({
    operation: 'detach-membership', working_set_id: workingSetId, membership_id: item.membership_id,
    item_type: item.item_type, item_id: item.item_id, source_authority: source.source_authority ?? 'unknown',
    membership_only: true, deletes_authoritative_data: false, execution_authority: source.source_authority ?? 'unknown', executable: false,
  }));

  return Object.freeze({
    working_set_id: workingSetId,
    name: String(source.name ?? '').trim(),
    description: source.description ?? null,
    source_authority: source.source_authority ?? 'unknown',
    context: child,
    items: Object.freeze(items),
    context_envelope: Object.freeze({
      version: '1.0', working_set_id: workingSetId, source_authority: source.source_authority ?? 'unknown',
      workspace_context: Object.freeze({ ...(source.context ?? {}) }), object_refs: Object.freeze([...new Set(objectRefs)].sort()),
      opaque_item_refs: Object.freeze([...new Set(opaqueRefs)].sort()), company_id: child.company_id, user_id: child.user_id,
      product_surface: child.product_surface, trace_id: child.trace_id, correlation_id: child.correlation_id,
      membership_grants_authorization: false, payloads_included: false,
    }),
    action_intents: Object.freeze(actionIntents),
    diagnostics: Object.freeze({ source: Object.freeze({ ...(source.diagnostics ?? {}) }), omitted: Object.freeze(omitted) }),
    authority_neutral: true,
    direct_business_writes: false,
  });
}
