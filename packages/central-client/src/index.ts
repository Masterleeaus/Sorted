/**
 * Central OIDC client for Sorted. Library only: no routes, no network at import time.
 * Flow: parseCentralOidcConfig -> fetchDiscovery -> beginLogin (store PendingLogin, single-use)
 *       -> openPendingLogin -> buildTokenExchangeBody -> verifyIdToken.
 */
export { CentralClientError } from "./errors";
export { CENTRAL_CLIENT_ENV, DEFAULT_SCOPE, parseCentralOidcConfig, type CentralOidcConfig } from "./config";
export { fetchDiscovery, type FetchLike, type OidcDiscovery } from "./discovery";
export { createJwksClient, type JwksClientOptions, type KeyResolver } from "./jwks";
export { codeChallengeS256, generateCodeVerifier, type RandomBytesSource } from "./pkce";
export {
  createLoginStateSealer,
  generateRandomToken,
  parseStateKey,
  stateDigest,
  type LoginStateSealer,
} from "./state";
export {
  beginLogin,
  buildTokenExchangeBody,
  LOGIN_TTL_MS,
  openPendingLogin,
  type BeginLoginResult,
  type PendingLogin,
} from "./authorize";
export { verifyIdToken, type VerifiedIdToken, type VerifyIdTokenOptions } from "./id-token";
