/**
 * Link assertion signer tests (issue #37, central/docs/LINKING.md).
 *
 * Central's verifier lives in another repository and cannot be imported here, so `centralRules` below
 * replicates its checks in the same order as LINKING.md "Verification order" (steps 2 to 10) and the
 * claim table. Each check cites its LINKING.md section. The signing key is generated per run; no key
 * material is committed.
 */
import { describe, it, expect } from 'vitest';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import {
  LINK_SIGNING_JWK_ENV,
  LINK_SIGNING_KID_ENV,
  LinkSigningError,
  loadLinkSigningKey,
  signLinkAssertion,
  type LinkAssertionInput,
  type LinkSigningKey,
} from './link-assertion.js';

const NOW_MS = Date.UTC(2026, 10, 15, 12, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);

const input: LinkAssertionInput = {
  sub: 'usr_7f3k2m9a',
  org: 'org_4hq8c1zd',
  lu: 'sorted-user-1842',
  la: 'sorted-acct-2291',
};

function makeKey(kid = 'sorted-2026-11'): { signing: LinkSigningKey; publicKey: KeyObject; env: Record<string, string> } {
  const pair = generateKeyPairSync('ed25519');
  const jwk = pair.privateKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string; d: string };
  const env = { [LINK_SIGNING_KID_ENV]: kid, [LINK_SIGNING_JWK_ENV]: JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: jwk.x, d: jwk.d }) };
  return { signing: loadLinkSigningKey(env), publicKey: pair.publicKey, env };
}

/** Public key as Central holds it: OKP JWK with kty, crv and x only (LINKING.md "Keys and rotation"). */
function centralPublicJwk(publicKey: KeyObject): { kty: 'OKP'; crv: 'Ed25519'; x: string } {
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
}

const FORBIDDEN = ['email', 'email_verified', 'name', 'given_name', 'family_name', 'display_name', 'displayName', 'preferred_username', 'username', 'nickname', 'phone_number'];
const REQUIRED = ['iss', 'aud', 'sub', 'org', 'lu', 'la', 'nonce', 'iat', 'exp'];
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;
const KID = /^[A-Za-z0-9._-]{1,64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

type Rule = 'malformed' | 'bad_algorithm' | 'unknown_product' | 'product_mismatch' | 'wrong_audience' | 'unknown_key' | 'key_inactive' | 'bad_signature' | 'forbidden_claim' | 'missing_claim' | 'identifier_not_permitted' | 'bad_lifetime' | 'future_dated' | 'expired' | 'subject_mismatch' | 'organisation_mismatch' | 'account_mismatch' | 'ok';

/**
 * Replicates Central LinkAssertionVerifier.verify (LINKING.md "Verification order"). Nonce replay (step 11)
 * is not replicated because it needs Central's store; the nonce format is checked at step 9.
 */
function centralRules(token: string, pub: { kty: string; crv: string; x: string }, kid: string, now: { nowMs: number; expectedSub: string; expectedOrg: string; lu: string; la: string }): Rule {
  // Step 2: three base64url segments, at most 4096 characters.
  if (token.length === 0 || token.length > 4096) return 'malformed';
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every(p => B64URL.test(p))) return 'malformed';
  const [h, c, s] = parts as [string, string, string];

  // Step 3: header alg/typ; unknown header fields are malformed.
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as Record<string, unknown>;
  if (header.alg !== 'EdDSA' || header.typ !== 'titan-link+jwt') return 'bad_algorithm';
  if (Object.keys(header).some(f => !['alg', 'typ', 'kid'].includes(f)) || typeof header.kid !== 'string' || !KID.test(header.kid)) return 'malformed';

  const claims = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as Record<string, unknown>;
  // Step 4: forbidden claims.
  if (FORBIDDEN.some(name => Object.hasOwn(claims, name))) return 'forbidden_claim';
  // Step 5: known product and matching application. Only 'sorted' is reachable from this package.
  if (claims.iss !== 'sorted') return claims.iss === 'supercharged' || claims.iss === 'lms' ? 'product_mismatch' : 'unknown_product';
  // Step 6: audience.
  if (claims.aud !== 'titan-central') return 'wrong_audience';
  // Step 7: kid exists in the product key set, and the key is inside its validity window.
  if (header.kid !== kid) return 'unknown_key';
  // Step 8: signature over the ASCII bytes of header.payload with the Ed25519 public key.
  const signature = Buffer.from(s, 'base64url');
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pub.x }, format: 'jwk' });
  if (signature.length !== 64 || !verifySignature(null, Buffer.from(`${h}.${c}`, 'ascii'), key, signature)) return 'bad_signature';
  // Step 9: required claims, lifetime, future-dated, expiry, identifiers, nonce.
  if (REQUIRED.some(name => !Object.hasOwn(claims, name))) return 'missing_claim';
  const { iat, exp } = claims as { iat: number; exp: number };
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp) || exp <= iat || exp - iat > 300) return 'bad_lifetime';
  if (iat * 1000 > now.nowMs + 30 * 1000) return 'future_dated';
  if (now.nowMs >= exp * 1000) return 'expired';
  for (const f of ['sub', 'org', 'lu', 'la'] as const) if (typeof claims[f] !== 'string' || !OPAQUE.test(claims[f] as string)) return 'identifier_not_permitted';
  if (typeof claims.nonce !== 'string' || !NONCE.test(claims.nonce)) return 'malformed';
  // Step 10: sub, org, lu and la equal Central's records and the command.
  if (claims.sub !== now.expectedSub) return 'subject_mismatch';
  if (claims.org !== now.expectedOrg) return 'organisation_mismatch';
  if (claims.lu !== now.lu || claims.la !== now.la) return 'account_mismatch';
  return 'ok';
}

/** Builds a token by hand, for negative cases the signer itself refuses to produce. */
function forge(privateKey: KeyObject, header: Record<string, unknown>, claims: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const c = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${c}.${signBytesWith(privateKey, `${h}.${c}`)}`;
}
const signBytesWith = (k: KeyObject, text: string): string => nodeSign(null, Buffer.from(text, 'ascii'), k).toString('base64url');

const baseClaims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: 'sorted', aud: 'titan-central', sub: input.sub, org: input.org, lu: input.lu, la: input.la,
  nonce: 'q2Xv8aB3cD4eF5gH6iJ7kL', iat: NOW_S, exp: NOW_S + 120, ...over,
});
const ctx = { nowMs: NOW_MS, expectedSub: input.sub, expectedOrg: input.org, lu: input.lu, la: input.la };

describe('RFC 8032 Ed25519 primitive', () => {
  it('matches the RFC 8032 test 1 public key and empty-message signature', () => {
    const seed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
    const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
    const priv = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    const pub = createPublicKey(priv);
    expect((pub.export({ format: 'jwk' }) as { x: string }).x).toBe('11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo');
    expect(signBytesWith(priv, '')).toBe(
      Buffer.from('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b', 'hex').toString('base64url'),
    );
  });
});

describe('signLinkAssertion output against Central rules (LINKING.md)', () => {
  it('produces a token Central accepts, with the exact header and claim set', () => {
    const { signing, publicKey } = makeKey();
    const out = signLinkAssertion(signing, input, { nowMs: NOW_MS, nonce: 'q2Xv8aB3cD4eF5gH6iJ7kL' });
    const [h, c] = out.token.split('.') as [string, string];
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'EdDSA', typ: 'titan-link+jwt', kid: 'sorted-2026-11' });
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    expect(Object.keys(claims).sort()).toEqual([...REQUIRED].sort());
    expect(claims).toEqual({ iss: 'sorted', aud: 'titan-central', sub: input.sub, org: input.org, lu: input.lu, la: input.la, nonce: 'q2Xv8aB3cD4eF5gH6iJ7kL', iat: NOW_S, exp: NOW_S + 120 });
    expect(centralRules(out.token, centralPublicJwk(publicKey), 'sorted-2026-11', ctx)).toBe('ok');
  });

  it('uses a 256 bit random nonce by default that Central accepts', () => {
    const { signing, publicKey } = makeKey();
    const a = signLinkAssertion(signing, input, { nowMs: NOW_MS });
    const b = signLinkAssertion(signing, input, { nowMs: NOW_MS });
    expect(a.nonce).toMatch(NONCE);
    expect(a.nonce.length).toBe(43);
    expect(a.nonce).not.toBe(b.nonce);
    expect(centralRules(a.token, centralPublicJwk(publicKey), 'sorted-2026-11', ctx)).toBe('ok');
  });

  it('accepts the maximum 300 second lifetime and rejects 301 at the signer', () => {
    const { signing, publicKey } = makeKey();
    const out = signLinkAssertion(signing, input, { nowMs: NOW_MS, ttlSeconds: 300 });
    expect(out.expiresAt - out.issuedAt).toBe(300);
    expect(centralRules(out.token, centralPublicJwk(publicKey), 'sorted-2026-11', ctx)).toBe('ok');
    expect(() => signLinkAssertion(signing, input, { nowMs: NOW_MS, ttlSeconds: 301 })).toThrow(LinkSigningError);
    expect(() => signLinkAssertion(signing, input, { nowMs: NOW_MS, ttlSeconds: 0 })).toThrow(LinkSigningError);
    expect(() => signLinkAssertion(signing, input, { nowMs: NOW_MS, ttlSeconds: 1.5 })).toThrow(LinkSigningError);
  });

  it('is accepted before exp and rejected at exp (LINKING.md step 9)', () => {
    const { signing, publicKey } = makeKey();
    const out = signLinkAssertion(signing, input, { nowMs: NOW_MS, ttlSeconds: 60 });
    const pub = centralPublicJwk(publicKey);
    expect(centralRules(out.token, pub, 'sorted-2026-11', { ...ctx, nowMs: NOW_MS + 59_000 })).toBe('ok');
    expect(centralRules(out.token, pub, 'sorted-2026-11', { ...ctx, nowMs: NOW_MS + 60_000 })).toBe('expired');
  });

  it('rejects a mismatched subject, organisation or account at Central step 10', () => {
    const { signing, publicKey } = makeKey();
    const out = signLinkAssertion(signing, input, { nowMs: NOW_MS });
    const pub = centralPublicJwk(publicKey);
    expect(centralRules(out.token, pub, 'sorted-2026-11', { ...ctx, expectedSub: 'usr_other999' })).toBe('subject_mismatch');
    expect(centralRules(out.token, pub, 'sorted-2026-11', { ...ctx, expectedOrg: 'org_other999' })).toBe('organisation_mismatch');
    expect(centralRules(out.token, pub, 'sorted-2026-11', { ...ctx, la: 'sorted-acct-9999' })).toBe('account_mismatch');
  });

  it('rejects an unknown kid and a signature from a different key', () => {
    const a = makeKey('sorted-2026-11');
    const b = makeKey('sorted-2026-11');
    const out = signLinkAssertion(a.signing, input, { nowMs: NOW_MS });
    expect(centralRules(out.token, centralPublicJwk(b.publicKey), 'sorted-2026-11', ctx)).toBe('bad_signature');
    expect(centralRules(out.token, centralPublicJwk(a.publicKey), 'sorted-2026-12', ctx)).toBe('unknown_key');
  });
});

describe('signer refuses identifiers Central would reject (LINKING.md identifier rule)', () => {
  const { signing } = makeKey();
  it.each([
    ['email address', 'jason@example.com'],
    ['display name with space', 'Jason Smith'],
    ['leading punctuation', '_usr_123456'],
    ['too short', 'usr_1'],
    ['empty', ''],
  ])('refuses a %s in sub', (_label, sub) => {
    expect(() => signLinkAssertion(signing, { ...input, sub }, { nowMs: NOW_MS })).toThrow(LinkSigningError);
  });

  it('refuses a short or non-base64url nonce', () => {
    expect(() => signLinkAssertion(signing, input, { nowMs: NOW_MS, nonce: 'short' })).toThrow(LinkSigningError);
    expect(() => signLinkAssertion(signing, input, { nowMs: NOW_MS, nonce: 'q2Xv8aB3cD4eF5gH6iJ7k+' })).toThrow(LinkSigningError);
  });
});

describe('Central rejection cases for hand-built tokens', () => {
  const { signing, publicKey } = makeKey();
  const pub = centralPublicJwk(publicKey);
  const hdr = { alg: 'EdDSA', typ: 'titan-link+jwt', kid: 'sorted-2026-11' };
  const priv = signing.privateKey;

  it('accepts a well-formed hand-built token (control)', () => {
    expect(centralRules(forge(priv, hdr, baseClaims()), pub, 'sorted-2026-11', ctx)).toBe('ok');
  });

  it.each([
    ['email claim', { email: 'a@b.co' }, 'forbidden_claim'],
    ['display name claim', { displayName: 'Jason' }, 'forbidden_claim'],
    ['wrong audience', { aud: 'someone-else' }, 'wrong_audience'],
    ['supercharged issuer', { iss: 'supercharged' }, 'product_mismatch'],
    ['lifetime 301', { exp: NOW_S + 301 }, 'bad_lifetime'],
    ['lifetime 0', { exp: NOW_S }, 'bad_lifetime'],
    ['future dated', { iat: NOW_S + 31, exp: NOW_S + 150 }, 'future_dated'],
    ['identifier with @', { lu: 'user@sorted' }, 'identifier_not_permitted'],
    ['nonce too short', { nonce: 'short' }, 'malformed'],
  ])('rejects %s', (_label, over, code) => {
    const claims = baseClaims(over as Record<string, unknown>);
    expect(centralRules(forge(priv, hdr, claims), pub, 'sorted-2026-11', ctx)).toBe(code);
  });

  it('rejects an alg other than EdDSA in the header', () => {
    expect(centralRules(forge(priv, { ...hdr, alg: 'HS256' }, baseClaims()), pub, 'sorted-2026-11', ctx)).toBe('bad_algorithm');
  });

  it('signer output never carries a forbidden claim', () => {
    const out = signLinkAssertion(signing, input, { nowMs: NOW_MS });
    const claims = JSON.parse(Buffer.from(out.token.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;
    for (const f of FORBIDDEN) expect(Object.hasOwn(claims, f)).toBe(false);
  });
});

describe('loadLinkSigningKey (env only, never logs)', () => {
  const { env } = makeKey('sorted-2026-11');

  it('loads a valid Ed25519 private OKP JWK', () => {
    const key = loadLinkSigningKey(env);
    expect(key.kid).toBe('sorted-2026-11');
    expect(key.privateKey.asymmetricKeyType).toBe('ed25519');
  });

  it('reports missing configuration without naming values', () => {
    expect(() => loadLinkSigningKey({})).toThrow(new LinkSigningError('config_missing'));
  });

  it('rejects a public-only JWK, a non-Ed25519 key and a malformed kid', () => {
    const pub = JSON.parse(env[LINK_SIGNING_JWK_ENV]!) as Record<string, string>;
    expect(() => loadLinkSigningKey({ ...env, [LINK_SIGNING_JWK_ENV]: JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: pub.x }) })).toThrow(LinkSigningError);
    expect(() => loadLinkSigningKey({ ...env, [LINK_SIGNING_JWK_ENV]: JSON.stringify({ ...pub, crv: 'X25519' }) })).toThrow(LinkSigningError);
    expect(() => loadLinkSigningKey({ ...env, [LINK_SIGNING_KID_ENV]: 'bad kid!' })).toThrow(LinkSigningError);
    expect(() => loadLinkSigningKey({ ...env, [LINK_SIGNING_JWK_ENV]: 'not json' })).toThrow(LinkSigningError);
  });

  it('error messages do not echo key material', () => {
    const pub = JSON.parse(env[LINK_SIGNING_JWK_ENV]!) as Record<string, string>;
    let message = '';
    try { loadLinkSigningKey({ ...env, [LINK_SIGNING_JWK_ENV]: JSON.stringify({ ...pub, d: 'AAAA' }) }); } catch (e) { message = String(e); }
    expect(message).toContain('config_invalid');
    expect(message).not.toContain(pub.d!);
    expect(message).not.toContain('AAAA');
  });
});
