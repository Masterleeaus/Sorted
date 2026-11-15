import { CentralClientError } from "./errors";
import { parseStrictUrl } from "./endpoint";
import { parseStateKey } from "./state";

/** Environment variable names. Mirrors central/deploy/env.example. */
export const CENTRAL_CLIENT_ENV = {
  issuer: "TITAN_OIDC_ISSUER",
  jwksUri: "TITAN_OIDC_JWKS_URI",
  audience: "TITAN_FIELD_AUDIENCE",
  stateKey: "TITAN_OIDC_STATE_KEY",
  clientId: "TITAN_FIELD_CLIENT_ID",
  redirectUri: "TITAN_FIELD_REDIRECT_URI",
  insecureLocalhost: "TITAN_ALLOW_INSECURE_LOCALHOST",
} as const;

export const DEFAULT_SCOPE = "openid profile email";

export interface CentralOidcConfig {
  readonly issuer: string;
  readonly jwksUri: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly audience: string;
  readonly scope: string;
  readonly stateKey: Buffer;
  readonly allowInsecureLocalhost: boolean;
}

type EnvLike = Readonly<Record<string, string | undefined>>;

function requireEnv(env: EnvLike, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new CentralClientError("config_invalid", `${name} must be set`);
  }
  return value.trim();
}

/**
 * Reads and validates OIDC settings. Pure: no network, no globals beyond the env argument.
 * Error messages name variables, never their values.
 */
export function parseCentralOidcConfig(env: EnvLike): CentralOidcConfig {
  const allowInsecureLocalhost = env[CENTRAL_CLIENT_ENV.insecureLocalhost] === "1";

  const issuerRaw = requireEnv(env, CENTRAL_CLIENT_ENV.issuer);
  const issuerUrl = parseStrictUrl(issuerRaw, allowInsecureLocalhost, CENTRAL_CLIENT_ENV.issuer);
  const jwksUrl = parseStrictUrl(requireEnv(env, CENTRAL_CLIENT_ENV.jwksUri), allowInsecureLocalhost, CENTRAL_CLIENT_ENV.jwksUri);
  if (jwksUrl.origin !== issuerUrl.origin) {
    throw new CentralClientError("config_invalid", `${CENTRAL_CLIENT_ENV.jwksUri} must share the issuer origin`);
  }

  const clientId = requireEnv(env, CENTRAL_CLIENT_ENV.clientId);
  if (clientId.length > 256 || /\s/.test(clientId)) {
    throw new CentralClientError("config_invalid", `${CENTRAL_CLIENT_ENV.clientId} is malformed`);
  }

  const redirectUrl = parseStrictUrl(requireEnv(env, CENTRAL_CLIENT_ENV.redirectUri), allowInsecureLocalhost, CENTRAL_CLIENT_ENV.redirectUri);

  const audience = requireEnv(env, CENTRAL_CLIENT_ENV.audience);
  if (audience.length > 256 || /\s/.test(audience)) {
    throw new CentralClientError("config_invalid", `${CENTRAL_CLIENT_ENV.audience} is malformed`);
  }

  let stateKey: Buffer;
  try {
    stateKey = parseStateKey(requireEnv(env, CENTRAL_CLIENT_ENV.stateKey));
  } catch {
    throw new CentralClientError("config_invalid", `${CENTRAL_CLIENT_ENV.stateKey} must be base64 for 32 bytes`);
  }

  return Object.freeze({
    // Kept exactly as configured: the ID token iss claim must match it byte for byte.
    issuer: issuerRaw,
    jwksUri: jwksUrl.href,
    clientId,
    redirectUri: redirectUrl.href,
    audience,
    scope: DEFAULT_SCOPE,
    stateKey,
    allowInsecureLocalhost,
  });
}
