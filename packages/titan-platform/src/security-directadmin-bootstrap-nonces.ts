import { isIdentityRegistryUnavailableError, type DirectAdminBootstrapNonceConsume,
  type DirectAdminBootstrapNonceIssued, type DirectAdminBootstrapNonceIssuedSelection,
  type DirectAdminBootstrapNonceSelection, type IdentitySessionRegistry } from './security-session-registry.js';
import { createDirectAdminBootstrapAssertionProvider, directAdminIssuer,
  parseDirectAdminSessionInfo, projectDirectAdminSessionIdentity, type DirectAdminAssertionTrust,
  type DirectAdminBootstrapContextRequest, type DirectAdminBootstrapProofEnvelope,
  directAdminSessionCookieHeader, type DirectAdminSessionApiFetch, type DirectAdminLoginAssertionInput } from './security-session-credentials.js';

const SESSION_RESPONSE_LIMIT = 256 * 1024;
const SESSION_TIMEOUT_MS = 5_000;

type SigningKey = CryptoKey | Uint8Array;

function requireId(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name}-required`);
  }
}

export type DirectAdminBootstrapNonceIssuerProof = Readonly<{
  origin: string;
  cookie: string;
  authorization: null;
  company_id: string;
  device_id: string;
}>;

/** Proof for the first-session path when no Titan cookie supplies context. */
export type DirectAdminBootstrapNonceIssuerIdentityProof = Readonly<{
  origin: string;
  cookie: string;
  authorization: null;
}>;

export type DirectAdminBootstrapNonceIssuerOptions = Readonly<{
  origin: string;
  registry: IdentitySessionRegistry;
  fetcher?: DirectAdminSessionApiFetch;
  lifetime_seconds?: number;
}>;

export type DirectAdminBootstrapFlowOptions = DirectAdminBootstrapNonceIssuerOptions & Readonly<{
  node_id: string;
  upstream: DirectAdminAssertionTrust;
  signing_key: SigningKey;
  now?: () => Date;
  assertion_lifetime_seconds?: number;
}>;

export type DirectAdminBootstrapFlow = Readonly<{
  issueNonce: (proof: DirectAdminBootstrapNonceIssuerProof) => Promise<DirectAdminBootstrapNonceIssued>;
  issueNonceForUniqueCurrentContext: (
    proof: DirectAdminBootstrapNonceIssuerIdentityProof,
  ) => Promise<DirectAdminBootstrapNonceIssuedSelection>;
  provide: (proof: DirectAdminBootstrapProofEnvelope) => Promise<DirectAdminLoginAssertionInput>;
}>;

function configuredOrigin(value: string): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) throw new Error('directadmin-issuer-origin-invalid');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('directadmin-issuer-origin-invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('directadmin-issuer-origin-invalid');
  }
  return url.origin;
}

function exactDataProperties(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('authentication-denied');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key))) {
    throw new Error('authentication-denied');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor)) throw new Error('authentication-denied');
    result[key] = descriptor.value;
  }
  return result;
}

function nonceIssueProof(value: unknown, origin: string): Readonly<{
  origin: string; cookie: string; company_id: string; device_id: string;
}> {
  const fields = exactDataProperties(value, ['origin', 'cookie', 'authorization', 'company_id', 'device_id']);
  if (fields.origin !== origin || fields.authorization !== null
    || typeof fields.company_id !== 'string' || typeof fields.device_id !== 'string') throw new Error('authentication-denied');
  const cookie = directAdminSessionCookieHeader(fields.cookie);
  requireId(fields.company_id, 'company_id');
  requireId(fields.device_id, 'device_id');
  return Object.freeze({ origin, cookie, company_id: fields.company_id, device_id: fields.device_id });
}

function nonceIssueIdentityProof(value: unknown, origin: string): Readonly<{ origin: string; cookie: string }> {
  const fields = exactDataProperties(value, ['origin', 'cookie', 'authorization']);
  if (fields.origin !== origin || fields.authorization !== null) throw new Error('authentication-denied');
  return Object.freeze({ origin, cookie: directAdminSessionCookieHeader(fields.cookie) });
}

function consumeRequest(value: DirectAdminBootstrapContextRequest, issuer: string): DirectAdminBootstrapNonceConsume {
  const fields = exactDataProperties(value, ['issuer', 'subject', 'real_subject', 'da_role', 'impersonating', 'csrf_nonce']);
  if (fields.issuer !== issuer || typeof fields.subject !== 'string' || typeof fields.real_subject !== 'string'
    || typeof fields.da_role !== 'string' || !['admin', 'reseller', 'user'].includes(fields.da_role)
    || typeof fields.impersonating !== 'boolean'
    || fields.impersonating !== (fields.real_subject !== fields.subject) || typeof fields.csrf_nonce !== 'string'
    || !/^[A-Za-z0-9_-]{43,128}$/.test(fields.csrf_nonce)) throw new Error('authentication-denied');
  requireId(fields.subject, 'subject');
  requireId(fields.real_subject, 'real_subject');
  return Object.freeze({ issuer, origin: issuer.slice('directadmin:'.length), subject: fields.subject,
    real_subject: fields.real_subject, da_role: fields.da_role as 'admin' | 'reseller' | 'user',
    impersonating: fields.impersonating, csrf_nonce: fields.csrf_nonce });
}

async function authenticatedIdentity(
  origin: string,
  cookie: string,
  fetcher: DirectAdminSessionApiFetch,
): Promise<ReturnType<typeof projectDirectAdminSessionIdentity>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
  try {
    const response = await fetcher(new URL('/api/session', origin), {
      method: 'GET', headers: { accept: 'application/json', cookie },
      redirect: 'error', cache: 'no-store', credentials: 'omit', signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) throw new Error('authentication-denied');
    if (response.status !== 200 || response.redirected) throw new Error('directadmin-service-unavailable');
    if (response.url) {
      const finalUrl = new URL(response.url);
      if (finalUrl.origin !== origin || finalUrl.pathname !== '/api/session' || finalUrl.search || finalUrl.hash) {
        throw new Error('directadmin-service-unavailable');
      }
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') throw new Error('directadmin-session-schema-unsupported');
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > SESSION_RESPONSE_LIMIT)) {
      throw new Error('directadmin-session-response-invalid');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('directadmin-session-response-invalid');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > SESSION_RESPONSE_LIMIT) {
          void reader.cancel().catch(() => {});
          throw new Error('directadmin-session-response-invalid');
        }
        chunks.push(next.value);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'directadmin-session-response-invalid') throw error;
      throw new Error('directadmin-service-unavailable');
    } finally {
      try { reader.releaseLock(); } catch { /* cancelled stream */ }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let sessionInfo: unknown;
    try { sessionInfo = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
    catch { throw new Error('directadmin-session-response-invalid'); }
    return projectDirectAdminSessionIdentity(origin, parseDirectAdminSessionInfo(sessionInfo));
  } catch (error) {
    if (error instanceof Error && ['authentication-denied', 'directadmin-session-schema-unsupported',
      'directadmin-session-response-invalid', 'directadmin-service-unavailable'].includes(error.message)) throw error;
    throw new Error('directadmin-service-unavailable');
  } finally { clearTimeout(timeout); }
}

/**
 * Trusted page-render/bootstrap issuer. It derives the effective DirectAdmin
 * subject only by authenticating the ambient cookie against the configured
 * host's `/api/session`; subject and actor IDs are not accepted from callers.
 * The one company/device selection is verified against current canonical
 * binding, membership, company, and device state before a hashed nonce is
 * persisted. Never expose this method as an unauthenticated public API.
 */
export function createDirectAdminBootstrapNonceIssuer(options: DirectAdminBootstrapNonceIssuerOptions): Readonly<{
  issue: (proof: DirectAdminBootstrapNonceIssuerProof) => Promise<DirectAdminBootstrapNonceIssued>;
  issueForUniqueCurrentContext: (
    proof: DirectAdminBootstrapNonceIssuerIdentityProof,
  ) => Promise<DirectAdminBootstrapNonceIssuedSelection>;
}> {
  const origin = configuredOrigin(options.origin);
  if (options.lifetime_seconds !== undefined && (!Number.isSafeInteger(options.lifetime_seconds)
    || options.lifetime_seconds < 1 || options.lifetime_seconds > 300)) {
    throw new Error('directadmin-bootstrap-nonce-lifetime-invalid');
  }
  const fetcher = options.fetcher ?? ((input: string | URL, init?: RequestInit) => fetch(input, init));
  const issue = async (proofInput: DirectAdminBootstrapNonceIssuerProof): Promise<DirectAdminBootstrapNonceIssued> => {
    const proof = nonceIssueProof(proofInput, origin);
    const identity = await authenticatedIdentity(origin, proof.cookie, fetcher);
    try {
      return await options.registry.issueDirectAdminBootstrapNonce({ origin: proof.origin, subject: identity.subject,
        real_subject: identity.real_subject, da_role: identity.da_role, impersonating: identity.impersonating,
        company_id: proof.company_id, device_id: proof.device_id,
        ...(options.lifetime_seconds === undefined ? {} : { lifetime_seconds: options.lifetime_seconds }) });
    } catch (error) {
      if (isIdentityRegistryUnavailableError(error)) throw new Error('directadmin-service-unavailable');
      if (error instanceof Error && ['identity-binding-ambiguous', 'identity-binding-unavailable',
        'identity-actor-unavailable', 'identity-company-unavailable', 'identity-membership-unavailable',
        'identity-device-unavailable'].includes(error.message)) throw new Error('authentication-denied');
      throw new Error('directadmin-service-unavailable');
    }
  };
  const issueForUniqueCurrentContext = async (
    proofInput: DirectAdminBootstrapNonceIssuerIdentityProof,
  ): Promise<DirectAdminBootstrapNonceIssuedSelection> => {
    const proof = nonceIssueIdentityProof(proofInput, origin);
    const identity = await authenticatedIdentity(origin, proof.cookie, fetcher);
    try {
      return await options.registry.issueDirectAdminBootstrapNonceForUniqueContext({ origin: proof.origin,
        subject: identity.subject, real_subject: identity.real_subject, da_role: identity.da_role,
        impersonating: identity.impersonating,
        ...(options.lifetime_seconds === undefined ? {} : { lifetime_seconds: options.lifetime_seconds }) });
    } catch (error) {
      if (isIdentityRegistryUnavailableError(error)) throw new Error('directadmin-service-unavailable');
      if (error instanceof Error && ['identity-binding-ambiguous', 'identity-binding-unavailable',
        'identity-actor-unavailable', 'identity-company-unavailable', 'identity-membership-unavailable',
        'identity-device-unavailable', 'identity-bootstrap-selection-ambiguous',
        'identity-bootstrap-selection-unavailable'].includes(error.message)) throw new Error('authentication-denied');
      throw new Error('directadmin-service-unavailable');
    }
  };
  return Object.freeze({ issue, issueForUniqueCurrentContext });
}

/** A ready-to-compose issuer callback for the existing signed assertion producer. */
export function createDirectAdminBootstrapNonceConsumer(
  registry: IdentitySessionRegistry,
  configuredOriginInput: string,
): (request: DirectAdminBootstrapContextRequest) => Promise<DirectAdminBootstrapNonceSelection | null> {
  const origin = configuredOrigin(configuredOriginInput);
  const issuer = directAdminIssuer(origin);
  return async request => {
    const binding = consumeRequest(request, issuer);
    try { return await registry.consumeDirectAdminBootstrapNonce(binding); }
    catch (error) {
      if (isIdentityRegistryUnavailableError(error)) throw new Error('directadmin-service-unavailable');
      throw new Error('authentication-denied');
    }
  };
}

/**
 * One configuration surface for #1049/#812 composition. It supplies the
 * durable canonical consumer to the assertion producer, removing the need for
 * a host-provided in-memory nonce callback.
 */
export function createDirectAdminBootstrapFlow(options: DirectAdminBootstrapFlowOptions): DirectAdminBootstrapFlow {
  const origin = configuredOrigin(options.origin);
  const issuer = createDirectAdminBootstrapNonceIssuer({ origin, registry: options.registry,
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    ...(options.lifetime_seconds === undefined ? {} : { lifetime_seconds: options.lifetime_seconds }) });
  const provider = createDirectAdminBootstrapAssertionProvider({
    origin, node_id: options.node_id, upstream: options.upstream, signing_key: options.signing_key,
    consumePreAuthNonce: createDirectAdminBootstrapNonceConsumer(options.registry, origin),
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.assertion_lifetime_seconds === undefined ? {} : { lifetime_seconds: options.assertion_lifetime_seconds }),
  });
  return Object.freeze({ issueNonce: issuer.issue, issueNonceForUniqueCurrentContext: issuer.issueForUniqueCurrentContext,
    provide: provider.provide });
}
