/**
 * Link assertion signer for Sorted (Central account linking, issue #37).
 *
 * Contract: central/docs/LINKING.md ("The assertion", "Keys and rotation", "Operator configuration").
 * Sorted proves control of one local user and one local account for one Central identity and organisation
 * by signing a short-lived compact JWS with its Ed25519 private key. Central verifies it against the public
 * key it holds for product `sorted`. This module only signs. It never verifies, stores or transmits keys.
 *
 * Keys come from the environment only:
 *   TITAN_LINK_SIGNING_KID   the key ID placed in the JWS header (kid)
 *   TITAN_LINK_SIGNING_JWK   the private Ed25519 key as an OKP JWK (kty OKP, crv Ed25519, x, d)
 * Neither value is logged, and error messages never echo a key, a claim value or the environment.
 */
import { createPrivateKey, randomBytes, sign as signBytes, type KeyObject } from 'node:crypto';
import type { LinkNonceStore } from './link-nonce-store';

export const SORTED_PRODUCT_ID = 'sorted' as const;
export const LINK_ASSERTION_AUDIENCE = 'titan-central' as const;
export const LINK_ASSERTION_TYPE = 'titan-link+jwt' as const;
/** Central rejects exp - iat above this (LINKING.md, claim table). */
export const LINK_ASSERTION_MAX_LIFETIME_SECONDS = 300;
/** Default lifetime when the caller does not pick one. Well inside the 300 second ceiling. */
export const LINK_ASSERTION_DEFAULT_LIFETIME_SECONDS = 120;
/** 32 random bytes is 256 bits, above the 128 bit minimum. Encodes to 43 base64url characters. */
const NONCE_BYTES = 32;

const KID = /^[A-Za-z0-9._-]{1,64}$/;
/** Opaque identifier: starts alphanumeric, no '@' (email), no whitespace (display names). LINKING.md "The assertion". */
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

export const LINK_SIGNING_KID_ENV = 'TITAN_LINK_SIGNING_KID';
export const LINK_SIGNING_JWK_ENV = 'TITAN_LINK_SIGNING_JWK';

/** The identifiers Central needs. All are immutable, opaque IDs issued by Sorted, never names or emails. */
export interface LinkAssertionInput {
  /** Central identity subject (Logto subject, usr_...) that Sorted received for this session. */
  sub: string;
  /** Logto organisation ID. */
  org: string;
  /** Sorted local user ID the link is for. Must equal the command's localUserId. */
  lu: string;
  /** Sorted local account ID the link is for. Must equal the command's localAccountId. */
  la: string;
}

export interface SignLinkAssertionOptions {
  /** Lifetime in seconds, integer 1 to 300. Default 120. */
  ttlSeconds?: number;
  /** Clock in milliseconds since epoch. Injected for tests. */
  nowMs?: number;
  /** Nonce source. Must be unpredictable and single use. Defaults to 32 random bytes. Injected for tests only. */
  nonce?: string;
}

export interface LinkSigningKey {
  /** Key ID written to the JWS header. */
  kid: string;
  /** Ed25519 private key. */
  privateKey: KeyObject;
}

export class LinkSigningError extends Error {
  constructor(
    readonly code:
      | 'config_missing'
      | 'config_invalid'
      | 'input_invalid'
      | 'forbidden_claim'
      | 'nonce_reused',
  ) {
    super(`link assertion signing failed: ${code}`);
    this.name = 'LinkSigningError';
  }
}

export interface SignedLinkAssertion {
  token: string;
  kid: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

const b64urlJson = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

function checkIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw new LinkSigningError('input_invalid');
  return value;
}

/**
 * Builds the signing key from environment values. Pure with respect to its argument: pass `process.env`
 * in production, a plain object in tests. Rejects anything that is not an Ed25519 private OKP JWK.
 */
export function loadLinkSigningKey(env: Readonly<Record<string, string | undefined>>): LinkSigningKey {
  const kid = env[LINK_SIGNING_KID_ENV];
  const jwkText = env[LINK_SIGNING_JWK_ENV];
  if (!kid || !jwkText) throw new LinkSigningError('config_missing');
  if (!KID.test(kid)) throw new LinkSigningError('config_invalid');

  let jwk: unknown;
  try { jwk = JSON.parse(jwkText); } catch { throw new LinkSigningError('config_invalid'); }
  if (jwk === null || typeof jwk !== 'object' || Array.isArray(jwk)) throw new LinkSigningError('config_invalid');
  const candidate = jwk as Record<string, unknown>;
  if (candidate.kty !== 'OKP' || candidate.crv !== 'Ed25519') throw new LinkSigningError('config_invalid');
  if (typeof candidate.x !== 'string' || !B64URL.test(candidate.x) || Buffer.from(candidate.x, 'base64url').length !== 32) throw new LinkSigningError('config_invalid');
  if (typeof candidate.d !== 'string' || !B64URL.test(candidate.d) || Buffer.from(candidate.d, 'base64url').length !== 32) throw new LinkSigningError('config_invalid');

  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: candidate.x, d: candidate.d }, format: 'jwk' });
  } catch {
    throw new LinkSigningError('config_invalid');
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new LinkSigningError('config_invalid');
  return { kid, privateKey };
}

/**
 * Signs one link assertion. Header is exactly {alg, typ, kid}. Claims are exactly the nine LINKING.md claims,
 * so no display name or email can be carried. Throws LinkSigningError on bad input; never returns a partial token.
 */
export function signLinkAssertion(
  key: LinkSigningKey,
  input: LinkAssertionInput,
  options: SignLinkAssertionOptions = {},
): SignedLinkAssertion {
  if (!KID.test(key.kid) || key.privateKey.asymmetricKeyType !== 'ed25519') throw new LinkSigningError('config_invalid');

  const sub = checkIdentifier(input.sub);
  const org = checkIdentifier(input.org);
  const lu = checkIdentifier(input.lu);
  const la = checkIdentifier(input.la);

  const ttl = options.ttlSeconds ?? LINK_ASSERTION_DEFAULT_LIFETIME_SECONDS;
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > LINK_ASSERTION_MAX_LIFETIME_SECONDS) throw new LinkSigningError('input_invalid');

  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isFinite(nowMs)) throw new LinkSigningError('input_invalid');
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ttl;

  const nonce = options.nonce ?? randomBytes(NONCE_BYTES).toString('base64url');
  if (!NONCE.test(nonce)) throw new LinkSigningError('input_invalid');

  const header = { alg: 'EdDSA', typ: LINK_ASSERTION_TYPE, kid: key.kid };
  const claims = {
    iss: SORTED_PRODUCT_ID,
    aud: LINK_ASSERTION_AUDIENCE,
    sub,
    org,
    lu,
    la,
    nonce,
    iat,
    exp,
  };

  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const signature = signBytes(null, Buffer.from(signingInput, 'ascii'), key.privateKey).toString('base64url');
  return { token: `${signingInput}.${signature}`, kid: key.kid, nonce, issuedAt: iat, expiresAt: exp };
}

/** Claims Central refuses on a link assertion (LINKING.md). The signer refuses them before issuing a token. */
const FORBIDDEN_IDENTITY_CLAIMS: ReadonlySet<string> = new Set([
  'email',
  'email_verified',
  'name',
  'given_name',
  'family_name',
  'display_name',
  'displayName',
  'preferred_username',
  'username',
  'nickname',
  'phone_number',
]);

export interface SignLinkAssertionWithNonceStoreOptions {
  /** Must equal 'sorted'. Defaults to SORTED_PRODUCT_ID. */
  issuer?: string;
  /** Must equal 'titan-central'. Defaults to LINK_ASSERTION_AUDIENCE. */
  audience?: string;
  /** Key ID written to the JWS header. */
  keyId: string;
  /** Ed25519 private key. */
  privateKey: KeyObject;
  /** Single-use nonce ledger. The nonce is reserved before the token is returned. */
  nonceStore: LinkNonceStore;
  /** Clock in whole seconds since epoch. Injected for tests. */
  now?: () => number;
  /** Lifetime in whole seconds, 1 to 300. Default 120. */
  lifetimeSeconds?: number;
  /** Nonce source. Must be unpredictable. Defaults to 32 random bytes. */
  nonceFactory?: () => string;
}

/**
 * Async signer for Sorted link assertions. Same claims, header and validation as signLinkAssertion,
 * plus the single-use nonce reservation. Refuses forbidden identity claims, unknown identifier shapes,
 * lifetimes outside 1 to 300 seconds, malformed nonces and any nonce already reserved in nonceStore.
 * Never returns a partial token. Errors are LinkSigningError with a code, never the key or claim values.
 */
export async function signLinkAssertionWithNonceStore(
  input: LinkAssertionInput,
  options: SignLinkAssertionWithNonceStoreOptions,
): Promise<SignedLinkAssertion> {
  const issuer = options.issuer ?? SORTED_PRODUCT_ID;
  const audience = options.audience ?? LINK_ASSERTION_AUDIENCE;
  if (issuer !== SORTED_PRODUCT_ID || audience !== LINK_ASSERTION_AUDIENCE) throw new LinkSigningError('config_invalid');

  if (input === null || typeof input !== 'object') throw new LinkSigningError('input_invalid');
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_IDENTITY_CLAIMS.has(key)) throw new LinkSigningError('forbidden_claim');
    if (key !== 'sub' && key !== 'org' && key !== 'lu' && key !== 'la') throw new LinkSigningError('input_invalid');
  }

  const nowSeconds = options.now ?? (() => Math.floor(Date.now() / 1000));
  const nowValue = nowSeconds();
  if (!Number.isSafeInteger(nowValue)) throw new LinkSigningError('input_invalid');

  // Validation and signing reuse the synchronous signer, so both paths share one set of rules.
  const signed = signLinkAssertion(
    { kid: options.keyId, privateKey: options.privateKey },
    input,
    {
      ttlSeconds: options.lifetimeSeconds,
      nowMs: nowValue * 1000,
      nonce: options.nonceFactory?.(),
    },
  );

  const reserved = await options.nonceStore.reserve(signed.nonce, signed.expiresAt);
  if (!reserved) throw new LinkSigningError('nonce_reused');
  return signed;
}
