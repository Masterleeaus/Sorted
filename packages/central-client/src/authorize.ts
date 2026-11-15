import type { CentralOidcConfig } from "./config";
import { CentralClientError } from "./errors";
import type { OidcDiscovery } from "./discovery";
import { codeChallengeS256, generateCodeVerifier, type RandomBytesSource } from "./pkce";
import { createLoginStateSealer, generateRandomToken, stateDigest, type LoginStateSealer } from "./state";

/** Login lifetime. Pending records older than this are rejected. */
export const LOGIN_TTL_MS = 10 * 60 * 1000;

/**
 * What the caller must store, durably and single-use, keyed by stateDigest.
 * The code verifier and nonce appear only sealed. The raw state is never stored.
 */
export interface PendingLogin {
  readonly stateDigest: string;
  readonly sealedCodeVerifier: string;
  readonly sealedNonce: string;
  readonly expiresAt: number;
}

export interface BeginLoginResult {
  readonly authorizationUrl: string;
  readonly state: string;
  readonly pending: PendingLogin;
}

export interface BeginLoginOptions {
  config: CentralOidcConfig;
  discovery: OidcDiscovery;
  now?: number;
  random?: RandomBytesSource;
}

const aadFor = (digest: string, field: string) => `sorted|oidc-login|${digest}|${field}`;

/** Starts an Authorization Code + PKCE login. Pure apart from the random source. */
export function beginLogin({ config, discovery, now = Date.now(), random }: BeginLoginOptions): BeginLoginResult {
  const sealer = createLoginStateSealer(config.stateKey);
  const state = generateRandomToken(random);
  const nonce = generateRandomToken(random);
  const verifier = generateCodeVerifier(random);
  const digest = stateDigest(state);

  const url = new URL(discovery.authorizationEndpoint);
  const params: Record<string, string> = {
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scope,
    state,
    nonce,
    code_challenge: codeChallengeS256(verifier),
    code_challenge_method: "S256",
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  return Object.freeze({
    authorizationUrl: url.href,
    state,
    pending: Object.freeze({
      stateDigest: digest,
      sealedCodeVerifier: sealer.seal(verifier, aadFor(digest, "verifier"), random),
      sealedNonce: sealer.seal(nonce, aadFor(digest, "nonce"), random),
      expiresAt: now + LOGIN_TTL_MS,
    }),
  });
}

export interface OpenPendingOptions {
  config: CentralOidcConfig;
  pending: PendingLogin;
  returnedState: string;
  now?: number;
  sealer?: LoginStateSealer;
}

/**
 * Checks the state echoed back by the provider against the stored record, then unseals the
 * verifier and nonce. The caller must delete the pending record atomically before calling this.
 */
export function openPendingLogin({ config, pending, returnedState, now = Date.now(), sealer }: OpenPendingOptions): {
  codeVerifier: string;
  nonce: string;
} {
  if (typeof returnedState !== "string" || returnedState.length === 0) {
    throw new CentralClientError("state_mismatch", "state missing");
  }
  if (stateDigest(returnedState) !== pending.stateDigest) {
    throw new CentralClientError("state_mismatch", "state mismatch");
  }
  if (now >= pending.expiresAt) {
    throw new CentralClientError("login_expired", "login expired");
  }
  const open = sealer ?? createLoginStateSealer(config.stateKey);
  return Object.freeze({
    codeVerifier: open.open(pending.sealedCodeVerifier, aadFor(pending.stateDigest, "verifier")),
    nonce: open.open(pending.sealedNonce, aadFor(pending.stateDigest, "nonce")),
  });
}

/** Form body for the token endpoint. The caller performs the POST. */
export function buildTokenExchangeBody(config: CentralOidcConfig, code: string, codeVerifier: string): URLSearchParams {
  if (typeof code !== "string" || code.length === 0 || code.length > 2048) {
    throw new CentralClientError("code_invalid", "authorization code missing");
  }
  return new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  });
}
