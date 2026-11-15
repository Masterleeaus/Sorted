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
export {
  LINK_ASSERTION_AUDIENCE,
  LINK_ASSERTION_DEFAULT_LIFETIME_SECONDS,
  LINK_ASSERTION_MAX_LIFETIME_SECONDS,
  LINK_ASSERTION_TYPE,
  LINK_SIGNING_JWK_ENV,
  LINK_SIGNING_KID_ENV,
  LinkSigningError,
  loadLinkSigningKey,
  SORTED_PRODUCT_ID,
  signLinkAssertion,
  type LinkAssertionInput,
  type LinkSigningKey,
  type SignLinkAssertionOptions,
  type SignedLinkAssertion,
} from "./link-assertion";
