/**
 * Central integration configuration.
 *
 * Two Central integrations share this module. Their variables and error types
 * are kept separate on purpose:
 *
 *   1. Identity and config service (Logto-backed OIDC, service tokens, flags,
 *      signed outbox events). Throws CentralConfigError.
 *   2. Titan Central account linking and service calls (link assertions,
 *      client-credentials service client). Throws CentralNotConfiguredError.
 *
 * Every value comes from the environment. Nothing here has a default that
 * points at a real Central deployment, and nothing is committed. A missing or
 * malformed value throws an error that names the variable, never its value.
 *
 * Identity and config variables (names only; see .env.example for placeholders):
 *   CENTRAL_ORIGIN                  https origin of Central, no path
 *   CENTRAL_OIDC_AUDIENCE           Sorted's own resource/audience in Central, sent as `resource`
 *   CENTRAL_OIDC_CLIENT_ID          OIDC client id issued by the Central operator
 *   CENTRAL_OIDC_CLIENT_SECRET      OIDC client secret issued by the Central operator
 *   APP_URL                         Sorted's public origin; the callback is derived from it
 *   CENTRAL_SERVICE_AUDIENCE        Product audience for server-to-server tokens
 *   CENTRAL_SERVICE_CLIENT_ID       Client-credentials client id
 *   CENTRAL_SERVICE_CLIENT_SECRET   Client-credentials client secret
 *   CENTRAL_OUTBOX_SECRET           Route secret for signed outbox events (>= 32 chars)
 *   CENTRAL_FLAGS_READ_ENABLED      "1" to read flags from Central; unset uses declared defaults
 *
 * Titan Central account linking and service calls (see .env.example):
 *   Account-link assertions (issue #37)
 *     TITAN_LINK_ISSUER          product id Central expects as `iss`   (contract: sorted)
 *     TITAN_LINK_AUDIENCE        Central audience for link assertions   (contract: titan-central)
 *     TITAN_LINK_KEY_ID          `kid` of the signing key registered with Central
 *     TITAN_LINK_PRIVATE_KEY     PKCS#8 PEM Ed25519 private key (server secret only)
 *   Service calls (issue #39)
 *     TITAN_CENTRAL_ORIGIN               Central API origin, e.g. https://central.example
 *     TITAN_CENTRAL_TOKEN_ENDPOINT       Logto token endpoint for the client-credentials grant
 *     TITAN_CENTRAL_SERVICE_CLIENT_ID    Logto client id for Sorted (secret store, not repo)
 *     TITAN_CENTRAL_SERVICE_CLIENT_SECRET Logto client secret for Sorted (secret store)
 *     TITAN_CENTRAL_PRODUCT_AUDIENCE     token audience, contract: urn:titan-central:product:sorted
 *
 * When a Titan Central value is missing, the reader throws
 * CentralNotConfiguredError naming the variable, so callers fail closed with a
 * clear message instead of sending requests with partial configuration.
 */

export class CentralConfigError extends Error {
  readonly variable: string;

  constructor(variable: string, message: string) {
    super(message);
    this.name = "CentralConfigError";
    this.variable = variable;
  }
}

export class CentralNotConfiguredError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`Titan Central is not configured: ${variable} is not set`);
    this.name = "CentralNotConfiguredError";
    this.variable = variable;
  }
}

export interface CentralOidcConfig {
  readonly origin: string;
  readonly audience: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface CentralServiceConfig {
  readonly origin: string;
  readonly audience: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

function requireValue(env: EnvSource, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new CentralConfigError(name, `${name} is not set. Set it in the environment (see .env.example).`);
  }
  return value;
}

function requireHttpsOrigin(env: EnvSource, name: string): string {
  const raw = requireValue(env, name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CentralConfigError(name, `${name} must be an absolute URL.`);
  }
  if (url.protocol !== "https:") {
    throw new CentralConfigError(name, `${name} must use https.`);
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new CentralConfigError(name, `${name} must be an origin only (no path, query, fragment or credentials).`);
  }
  return url.origin;
}

export function readCentralOidcConfig(env: EnvSource = process.env): CentralOidcConfig {
  const origin = requireHttpsOrigin(env, "CENTRAL_ORIGIN");
  const audience = requireValue(env, "CENTRAL_OIDC_AUDIENCE");
  const clientId = requireValue(env, "CENTRAL_OIDC_CLIENT_ID");
  const clientSecret = requireValue(env, "CENTRAL_OIDC_CLIENT_SECRET");
  const appUrl = requireValue(env, "APP_URL");
  let redirectUri: string;
  try {
    redirectUri = new URL("/auth/titan/callback", appUrl).toString();
  } catch {
    throw new CentralConfigError("APP_URL", "APP_URL must be an absolute URL.");
  }
  return { origin, audience, clientId, clientSecret, redirectUri };
}

export function readCentralServiceConfig(env: EnvSource = process.env): CentralServiceConfig {
  return {
    origin: requireHttpsOrigin(env, "CENTRAL_ORIGIN"),
    audience: requireValue(env, "CENTRAL_SERVICE_AUDIENCE"),
    clientId: requireValue(env, "CENTRAL_SERVICE_CLIENT_ID"),
    clientSecret: requireValue(env, "CENTRAL_SERVICE_CLIENT_SECRET"),
  };
}

export function readCentralOutboxSecret(env: EnvSource = process.env): string {
  const secret = requireValue(env, "CENTRAL_OUTBOX_SECRET");
  if (secret.length < 32) {
    throw new CentralConfigError("CENTRAL_OUTBOX_SECRET", "CENTRAL_OUTBOX_SECRET must be at least 32 characters.");
  }
  return secret;
}

export function isCentralFlagReadEnabled(env: EnvSource = process.env): boolean {
  return env.CENTRAL_FLAGS_READ_ENABLED === "1";
}

function requireEnv(name: string, env: EnvSource = process.env): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new CentralNotConfiguredError(name);
  }
  return value.trim();
}

export function readLinkConfig(env: EnvSource = process.env) {
  return {
    issuer: requireEnv("TITAN_LINK_ISSUER", env),
    audience: requireEnv("TITAN_LINK_AUDIENCE", env),
    keyId: requireEnv("TITAN_LINK_KEY_ID", env),
    // Literal "\n" sequences are accepted so the PEM can live on one env line.
    privateKeyPem: requireEnv("TITAN_LINK_PRIVATE_KEY", env).replace(/\\n/g, "\n"),
  };
}

export function readServiceConfig(env: EnvSource = process.env) {
  return {
    origin: requireEnv("TITAN_CENTRAL_ORIGIN", env),
    tokenEndpoint: requireEnv("TITAN_CENTRAL_TOKEN_ENDPOINT", env),
    clientId: requireEnv("TITAN_CENTRAL_SERVICE_CLIENT_ID", env),
    clientSecret: requireEnv("TITAN_CENTRAL_SERVICE_CLIENT_SECRET", env),
    audience: requireEnv("TITAN_CENTRAL_PRODUCT_AUDIENCE", env),
  };
}
