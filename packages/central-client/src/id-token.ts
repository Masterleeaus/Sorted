import { createVerify, timingSafeEqual } from "node:crypto";
import type { CentralOidcConfig } from "./config";
import { CentralClientError } from "./errors";
import type { KeyResolver } from "./jwks";

const MAX_TOKEN_CHARS = 16 * 1024;
const DEFAULT_MAX_AGE_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 60;

export interface VerifiedIdToken {
  readonly iss: string;
  readonly sub: string;
  readonly aud: readonly string[];
  readonly azp?: string;
  readonly nonce: string;
  readonly iat: number;
  readonly exp: number;
}

export interface VerifyIdTokenOptions {
  token: string;
  config: Pick<CentralOidcConfig, "issuer" | "clientId">;
  expectedNonce: string;
  keys: KeyResolver;
  now?: number;
  /** Maximum age of iat, in seconds. */
  maxAgeSeconds?: number;
}

function fail(reason: string): never {
  throw new CentralClientError("id_token_invalid", reason);
}

function decodeSegment(segment: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) fail("malformed segment");
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) fail("segment is not an object");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CentralClientError) throw error;
    return fail("segment is not JSON");
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Verifies a Central/Logto ID token: RS256 signature from the pinned JWKS, exact issuer,
 * audience equal to the client id (with azp rules), subject, nonce, and time claims.
 * Returns only the verified claim subset the caller needs.
 */
export async function verifyIdToken(options: VerifyIdTokenOptions): Promise<VerifiedIdToken> {
  const { token, config, expectedNonce, keys } = options;
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) fail("token size");
  if (typeof expectedNonce !== "string" || expectedNonce.length === 0) fail("nonce missing");

  const parts = token.split(".");
  if (parts.length !== 3) fail("token shape");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const header = decodeSegment(headerPart);
  if (header.alg !== "RS256") fail("algorithm not allowed");
  if (header.typ !== undefined && (typeof header.typ !== "string" || header.typ.toUpperCase() !== "JWT")) fail("type not allowed");
  if (typeof header.kid !== "string" || header.kid.length === 0) fail("kid missing");

  const key = await keys.getKey(header.kid);

  if (!/^[A-Za-z0-9_-]+$/.test(signaturePart) || signaturePart.length === 0) fail("signature encoding");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerPart}.${payloadPart}`, "utf8");
  verifier.end();
  if (!verifier.verify(key, Buffer.from(signaturePart, "base64url"))) fail("signature invalid");

  const claims = decodeSegment(payloadPart);
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const maxAge = options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

  if (claims.iss !== config.issuer) fail("issuer mismatch");

  const aud = Array.isArray(claims.aud) ? claims.aud : typeof claims.aud === "string" ? [claims.aud] : null;
  if (!aud || aud.some((v) => typeof v !== "string")) fail("audience malformed");
  const audiences = aud as string[];
  if (!audiences.includes(config.clientId)) fail("audience mismatch");
  if (audiences.length > 1 && claims.azp !== config.clientId) fail("azp required for multiple audiences");
  if (claims.azp !== undefined && claims.azp !== config.clientId) fail("azp mismatch");

  const sub = claims.sub;
  if (typeof sub !== "string" || sub.length === 0) fail("subject missing");
  const nonce = claims.nonce;
  if (typeof nonce !== "string" || !constantTimeEqual(nonce, expectedNonce)) fail("nonce mismatch");

  if (!Number.isSafeInteger(claims.iat)) fail("iat missing");
  if (!Number.isSafeInteger(claims.exp)) fail("exp missing");
  const iat = claims.iat as number;
  const exp = claims.exp as number;
  if (iat > now + CLOCK_SKEW_SECONDS) fail("iat in the future");
  if (iat < now - maxAge - CLOCK_SKEW_SECONDS) fail("token too old");
  if (exp <= now) fail("token expired");
  if (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || (claims.nbf as number) > now + CLOCK_SKEW_SECONDS)) {
    fail("nbf not yet valid");
  }

  return Object.freeze({
    iss: config.issuer,
    sub,
    aud: Object.freeze([...audiences]),
    azp: typeof claims.azp === "string" ? claims.azp : undefined,
    nonce: expectedNonce,
    iat,
    exp,
  });
}
