/**
 * OIDC authorization code flow with PKCE against Central's discovery document.
 *
 * Pure protocol logic. Network access is injected (`fetch`), and ID token
 * keys are injected (`JWTVerifyGetKey`), so tests run with fakes only.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { jwtVerify, errors as joseErrors, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { CentralOidcConfig } from "./config";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class OidcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OidcError";
    this.code = code;
  }
}

export interface OidcDiscovery {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
}

const ID_TOKEN_ALGORITHMS = ["RS256", "ES256", "ES384", "EdDSA"];
const CLOCK_TOLERANCE_SECONDS = 30;

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

/** RFC 7636 PKCE pair using S256. `random` is injectable for tests. */
export function createPkcePair(random: () => Buffer = () => randomBytes(32)): { verifier: string; challenge: string } {
  const verifier = base64url(random());
  const challenge = base64url(createHash("sha256").update(verifier, "ascii").digest());
  return { verifier, challenge };
}

function assertHttpsUrl(value: unknown, field: string, issuerOrigin?: string): string {
  if (typeof value !== "string") throw new OidcError("bad_discovery", `discovery ${field} is missing`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcError("bad_discovery", `discovery ${field} is not a URL`);
  }
  if (url.protocol !== "https:") throw new OidcError("bad_discovery", `discovery ${field} must use https`);
  if (issuerOrigin !== undefined && url.origin !== issuerOrigin) {
    throw new OidcError("bad_discovery", `discovery ${field} is not on the issuer origin`);
  }
  return value;
}

/** Fetches and checks the discovery document. Endpoints must share the issuer's origin. */
export async function fetchDiscovery(origin: string, fetchImpl: FetchLike): Promise<OidcDiscovery> {
  const res = await fetchImpl(new URL("/.well-known/openid-configuration", origin).toString(), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new OidcError("discovery_failed", `discovery answered HTTP ${res.status}`);
  const body = (await res.json()) as Partial<Record<keyof OidcDiscovery, unknown>>;
  if (typeof body.issuer !== "string") throw new OidcError("bad_discovery", "discovery issuer is missing");
  const issuerOrigin = new URL(assertHttpsUrl(body.issuer, "issuer")).origin;
  return {
    issuer: body.issuer,
    authorization_endpoint: assertHttpsUrl(body.authorization_endpoint, "authorization_endpoint", issuerOrigin),
    token_endpoint: assertHttpsUrl(body.token_endpoint, "token_endpoint", issuerOrigin),
    jwks_uri: assertHttpsUrl(body.jwks_uri, "jwks_uri", issuerOrigin),
  };
}

export interface AuthorizationRequest {
  readonly url: string;
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
}

/** Builds the authorization redirect. The audience is Sorted's own per-app audience. */
export function createAuthorizationRequest(
  discovery: OidcDiscovery,
  config: CentralOidcConfig,
  random: () => Buffer = () => randomBytes(32),
): AuthorizationRequest {
  const { verifier, challenge } = createPkcePair(random);
  const state = base64url(random());
  const nonce = base64url(random());
  const url = new URL(discovery.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "openid",
    audience: config.audience,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), state, nonce, verifier };
}

/** Constant-time comparison of the state returned on the callback. */
export function stateMatches(expected: string, received: string | null | undefined): boolean {
  if (typeof received !== "string") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`;
}

/** Exchanges the authorization code. Errors never include the response body. */
export async function exchangeAuthorizationCode(args: {
  discovery: OidcDiscovery;
  config: CentralOidcConfig;
  code: string;
  verifier: string;
  fetch: FetchLike;
}): Promise<{ idToken: string; accessToken: string | null }> {
  const { discovery, config } = args;
  const res = await args.fetch(discovery.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: basicAuth(config.clientId, config.clientSecret),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: config.redirectUri,
      code_verifier: args.verifier,
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new OidcError("token_exchange_failed", `token endpoint answered HTTP ${res.status}`);
  const body = (await res.json()) as { id_token?: unknown; access_token?: unknown };
  if (typeof body.id_token !== "string" || body.id_token.length === 0) {
    throw new OidcError("token_exchange_failed", "token response has no id_token");
  }
  return {
    idToken: body.id_token,
    accessToken: typeof body.access_token === "string" ? body.access_token : null,
  };
}

function mapJoseError(error: unknown): string {
  if (error instanceof joseErrors.JWTExpired) return "expired_id_token";
  if (error instanceof joseErrors.JWTClaimValidationFailed) {
    if (error.claim === "aud") return "wrong_audience";
    if (error.claim === "iss") return "wrong_issuer";
    return "invalid_claim";
  }
  if (error instanceof joseErrors.JWSSignatureVerificationFailed) return "bad_signature";
  if (error instanceof joseErrors.JWKSNoMatchingKey) return "bad_signature";
  return "invalid_id_token";
}

/**
 * Verifies the ID token: signature, issuer, audience (Sorted's own audience),
 * expiry, and the nonce bound to this login. Returns the verified claims.
 */
export async function verifyIdToken(args: {
  idToken: string;
  issuer: string;
  audience: string;
  nonce: string;
  jwks: JWTVerifyGetKey;
  now: number;
}): Promise<JWTPayload & { sub: string }> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(args.idToken, args.jwks, {
      issuer: args.issuer,
      audience: args.audience,
      algorithms: ID_TOKEN_ALGORITHMS,
      currentDate: new Date(args.now * 1000),
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    }));
  } catch (error) {
    throw new OidcError(mapJoseError(error), "ID token failed verification");
  }
  if (payload.nonce !== args.nonce) throw new OidcError("nonce_mismatch", "ID token nonce does not match this login");
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new OidcError("invalid_id_token", "ID token has no subject");
  }
  return payload as JWTPayload & { sub: string };
}

/** Central's global logout endpoint, on Central's origin. */
export function globalLogoutUrl(config: Pick<CentralOidcConfig, "origin">): string {
  return new URL("/auth/titan/global-logout", config.origin).toString();
}
