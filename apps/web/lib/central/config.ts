/**
 * Central (Logto-backed identity and config service) client configuration.
 *
 * Every value comes from the environment. Nothing here has a default that
 * points at a real Central deployment, and nothing is committed. A missing or
 * malformed value throws a CentralConfigError that names the variable, never
 * its value.
 *
 * Variables (names only; see .env.example for placeholders):
 *   CENTRAL_ORIGIN                  https origin of Central, no path
 *   CENTRAL_OIDC_AUDIENCE           Sorted's own audience in Central (TITAN_FIELD_AUDIENCE)
 *   CENTRAL_OIDC_CLIENT_ID          OIDC client id issued by the Central operator
 *   CENTRAL_OIDC_CLIENT_SECRET      OIDC client secret issued by the Central operator
 *   APP_URL                         Sorted's public origin; the callback is derived from it
 *   CENTRAL_SERVICE_AUDIENCE        Product audience for server-to-server tokens
 *   CENTRAL_SERVICE_CLIENT_ID       Client-credentials client id
 *   CENTRAL_SERVICE_CLIENT_SECRET   Client-credentials client secret
 *   CENTRAL_OUTBOX_SECRET           Route secret for signed outbox events (>= 32 chars)
 *   CENTRAL_FLAGS_READ_ENABLED      "1" to read flags from Central; unset uses declared defaults
 */

export class CentralConfigError extends Error {
  readonly variable: string;

  constructor(variable: string, message: string) {
    super(message);
    this.name = "CentralConfigError";
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

// Titan Central link and service configuration (issues #37, #39).
export class CentralNotConfiguredError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`Titan Central is not configured: ${variable} is not set`);
    this.name = "CentralNotConfiguredError";
    this.variable = variable;
  }
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
