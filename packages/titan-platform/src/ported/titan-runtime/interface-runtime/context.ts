// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interface-runtime/context.mjs
import { assertCanonicalCompanyId, rejectLegacyTenantAuthorityDeep } from '../boundary.js';

const TOKEN = /^[a-z][a-z0-9._-]{0,63}$/;
const SURFACE_ALIASES = Object.freeze({ zero:'zero', bos:'zero', command:'zero', owner:'zero', manager:'zero', business:'zero', go:'go', field:'go', worker:'go', hub:'hub', customer:'hub' });
const canonicalProductSurface = (value) => { const raw=token(value,'product_surface'); const surface=SURFACE_ALIASES[raw]; if (!surface) throw new TypeError('product_surface must resolve to zero, go or hub'); return surface; };
const TRACE = /^[A-Za-z0-9._:-]+$/;
const PROTECTED = new Set(['company_id','user_id','roles','capabilities','product_surface','trace_id','correlation_id']);
const ALLOWED_DERIVED = new Set(['domain','branch_id','workspace_id','team_id','device_id','object_ref','conversation_id','journey_id','causation_id']);

const text = (value, field) => {
  const out = String(value ?? '').trim();
  if (!out) throw new TypeError(`${field} is required`);
  return out;
};
const token = (value, field) => {
  const out = text(value, field);
  if (!TOKEN.test(out)) throw new TypeError(`${field} contains an unsafe or unsupported token`);
  return out;
};
const ref = (value, field) => {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > 255 || /[\x00-\x1F\x7F]/.test(value)) {
    throw new TypeError(`${field} contains an invalid reference`);
  }
  return value;
};
const trace = (value, field, prefix) => {
  const out = value == null || value === '' ? `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}` : String(value);
  if (out.length > 128 || !TRACE.test(out)) throw new TypeError(`${field} contains an invalid trace identifier`);
  return out;
};
const list = (value, field) => Object.freeze((Array.isArray(value) ? value : []).map((item) => {
  if (typeof item !== 'string' || item.length === 0 || item.length > 160) throw new TypeError(`${field} must contain non-empty bounded strings only`);
  return item;
}));

export function createInterfaceContext(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('interface context must be an object');
  rejectLegacyTenantAuthorityDeep(input, 'interface_context');
  const company_id = assertCanonicalCompanyId(input.company_id);
  const user_id = text(input.user_id, 'user_id');
  const branch = input.branch_id == null ? null : Number(input.branch_id);
  if (branch != null && (!Number.isInteger(branch) || branch <= 0)) throw new TypeError('branch_id must be a positive integer when present');
  return Object.freeze({
    schema: 'titan.interface-context.v2',
    context_version: '2.0',
    company_id,
    user_id,
    product_surface: canonicalProductSurface(input.product_surface),
    domain: token(input.domain, 'domain'),
    branch_id: branch,
    workspace_id: ref(input.workspace_id, 'workspace_id'),
    team_id: ref(input.team_id, 'team_id'),
    device_id: ref(input.device_id, 'device_id'),
    object_ref: ref(input.object_ref, 'object_ref'),
    conversation_id: ref(input.conversation_id, 'conversation_id'),
    journey_id: ref(input.journey_id, 'journey_id'),
    roles: list(input.roles, 'roles'),
    capabilities: list(input.capabilities, 'capabilities'),
    trace_id: trace(input.trace_id, 'trace_id', 'trace'),
    correlation_id: trace(input.correlation_id, 'correlation_id', 'corr'),
    causation_id: input.causation_id == null ? null : trace(input.causation_id, 'causation_id', 'cause'),
    authority_neutral: true,
    context_changes_grant_authority: false,
  });
}

export function deriveInterfaceContext(context, changes = {}) {
  const base = createInterfaceContext(context);
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('context changes must be an object');
  rejectLegacyTenantAuthorityDeep(changes, 'interface_context_changes');
  for (const key of Object.keys(changes)) {
    if (PROTECTED.has(key)) throw new TypeError(`${key} cannot be changed by context propagation`);
    if (!ALLOWED_DERIVED.has(key)) throw new TypeError(`unknown interface context field '${key}'`);
  }
  return createInterfaceContext({ ...base, ...changes });
}

export function hasInterfaceCapability(context, capability) {
  const wanted = text(capability, 'capability');
  const caps = Array.isArray(context?.capabilities) ? context.capabilities : [];
  return caps.includes('*') || caps.includes(wanted);
}

export function hasInterfaceCapabilities(context, required = []) {
  return (Array.isArray(required) ? required : []).every((capability) => hasInterfaceCapability(context, capability));
}
