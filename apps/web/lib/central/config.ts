/**
 * Titan Central integration configuration.
 *
 * Every value is read from the environment at call time. Nothing is baked into
 * the repository. When a value is missing, the reader throws
 * CentralNotConfiguredError naming the variable, so callers fail closed with a
 * clear message instead of sending requests with partial configuration.
 *
 * Variables (see .env.example):
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
 */

export class CentralNotConfiguredError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`Titan Central is not configured: ${variable} is not set`);
    this.name = "CentralNotConfiguredError";
    this.variable = variable;
  }
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

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
