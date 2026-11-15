import { createPrivateKey, randomBytes, type KeyObject } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { readLinkConfig, type EnvSource } from "./config";

/**
 * Account-link assertion signer (Central contract, docs/LINKING.md, issue #37).
 *
 * Compact JWS, alg EdDSA (Ed25519), typ `titan-link+jwt`, kid = configured key id.
 * The payload is built from an explicit allowlist of claims. Identity fields
 * such as email or display name cannot reach the token.
 */

const LINK_ASSERTION_TYP = "titan-link+jwt";
const LINK_ASSERTION_MAX_LIFETIME_SECONDS = 300;
const LINK_ASSERTION_DEFAULT_LIFETIME_SECONDS = 120;
const LINK_NONCE_BYTES = 32; // 256 bits -> 43 base64url characters

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
// Product id, audience and kid are short configuration tokens ("sorted", "titan-central").
const CONFIG_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

/** Claim names Central refuses. Sorted must never place these in an assertion. */
export const FORBIDDEN_LINK_CLAIMS = [
  "email",
  "email_verified",
  "name",
  "given_name",
  "family_name",
  "display_name",
  "displayName",
  "preferred_username",
  "username",
  "nickname",
  "phone_number",
] as const;

const ALLOWED_INPUT_KEYS = ["sub", "org", "lu", "la"] as const;

export class LinkAssertionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LinkAssertionError";
    this.code = code;
  }
}

export type LinkAssertionInput = Readonly<{
  /** Central identity subject, `usr_...`. */
  sub: string;
  /** Logto organisation id. */
  org: string;
  /** Sorted local user id (opaque, immutable). */
  lu: string;
  /** Sorted local account id (opaque, immutable). */
  la: string;
}>;

/**
 * Single-use nonce tracking on the Sorted side. Central enforces single use as
 * well. Production wiring needs a durable implementation shared by all
 * processes (see the PR notes). The in-memory store is for tests and single
 * process use only.
 */
interface LinkNonceStore {
  /** Returns false when the nonce was already reserved. */
  reserve(nonce: string, expiresAtSeconds: number): Promise<boolean>;
}

export function createMemoryLinkNonceStore(now: () => number = nowSeconds): LinkNonceStore {
  const seen = new Map<string, number>();
  return {
    async reserve(nonce, expiresAtSeconds) {
      const current = now();
      for (const [key, expiry] of seen) {
        if (expiry <= current) seen.delete(key);
      }
      if (seen.has(nonce)) return false;
      seen.set(nonce, expiresAtSeconds);
      return true;
    },
  };
}

export type LinkSigningOptions = Readonly<{
  issuer: string;
  audience: string;
  keyId: string;
  privateKey: KeyObject | CryptoKey;
  nonceStore: LinkNonceStore;
  lifetimeSeconds?: number;
  now?: () => number;
  /** Test hook. Production uses random nonces. */
  nonceFactory?: () => string;
}>;

export type SignedLinkAssertion = Readonly<{
  token: string;
  nonce: string;
  iat: number;
  exp: number;
}>;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function generateLinkNonce(): string {
  return randomBytes(LINK_NONCE_BYTES).toString("base64url");
}

function assertIdentifier(name: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new LinkAssertionError("invalid_identifier", `${name} is not a valid identifier`);
  }
}

function assertSubject(value: unknown): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value) || !value.startsWith("usr_")) {
    throw new LinkAssertionError("invalid_subject", "sub must be a Central usr_ identifier");
  }
}

function assertConfigValue(name: string, value: unknown, pattern: RegExp): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new LinkAssertionError("invalid_config", `${name} is not a valid value`);
  }
}

/** Rejects forbidden identity claims and any key outside the allowlist. */
function assertLinkInputShape(input: Record<string, unknown>): void {
  for (const key of Object.keys(input)) {
    if ((FORBIDDEN_LINK_CLAIMS as readonly string[]).includes(key)) {
      throw new LinkAssertionError("forbidden_claim", `claim ${key} is never permitted in a link assertion`);
    }
    if (!(ALLOWED_INPUT_KEYS as readonly string[]).includes(key)) {
      throw new LinkAssertionError("unknown_claim", `claim ${key} is not part of the link contract`);
    }
  }
}

/** Signs a link assertion. The caller supplies only the four identity fields. */
export async function signLinkAssertion(
  input: LinkAssertionInput,
  options: LinkSigningOptions,
): Promise<SignedLinkAssertion> {
  assertLinkInputShape(input as unknown as Record<string, unknown>);
  assertSubject(input.sub);
  assertIdentifier("org", input.org);
  assertIdentifier("lu", input.lu);
  assertIdentifier("la", input.la);
  assertConfigValue("iss", options.issuer, CONFIG_VALUE_PATTERN);
  assertConfigValue("aud", options.audience, CONFIG_VALUE_PATTERN);
  assertConfigValue("kid", options.keyId, CONFIG_VALUE_PATTERN);

  const lifetime = options.lifetimeSeconds ?? LINK_ASSERTION_DEFAULT_LIFETIME_SECONDS;
  if (!Number.isInteger(lifetime) || lifetime <= 0 || lifetime > LINK_ASSERTION_MAX_LIFETIME_SECONDS) {
    throw new LinkAssertionError("lifetime_exceeded", "exp - iat must be between 1 and 300 seconds");
  }

  const iat = (options.now ?? nowSeconds)();
  const exp = iat + lifetime;
  const nonce = (options.nonceFactory ?? generateLinkNonce)();
  if (!NONCE_PATTERN.test(nonce)) {
    throw new LinkAssertionError("invalid_nonce", "nonce must be 22 to 128 base64url characters");
  }
  if (!(await options.nonceStore.reserve(nonce, exp))) {
    throw new LinkAssertionError("nonce_reused", "nonce was already issued");
  }

  const token = await new SignJWT({ org: input.org, lu: input.lu, la: input.la, nonce })
    .setProtectedHeader({ alg: "EdDSA", typ: LINK_ASSERTION_TYP, kid: options.keyId })
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setSubject(input.sub)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(options.privateKey);

  return { token, nonce, iat, exp };
}

/**
 * Loads the Ed25519 signing key from configuration. Throws
 * CentralNotConfiguredError when unset and LinkAssertionError when the key is
 * not an Ed25519 PKCS#8 private key.
 */
export async function loadLinkSigningKey(env: EnvSource = process.env): Promise<KeyObject> {
  const { privateKeyPem } = readLinkConfig(env);
  let key: KeyObject;
  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    throw new LinkAssertionError("invalid_key", "TITAN_LINK_PRIVATE_KEY is not a valid PEM private key");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new LinkAssertionError("invalid_key", "TITAN_LINK_PRIVATE_KEY must be an Ed25519 key");
  }
  // Round-trip through jose so the key is accepted by the same library that signs.
  await importPKCS8(privateKeyPem, "EdDSA");
  return key;
}

