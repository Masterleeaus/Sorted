import type { CentralOidcConfig } from "./config";
import { CentralClientError } from "./errors";
import { parseStrictUrl } from "./endpoint";

export interface OidcDiscovery {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
}

export type FetchLike = (input: string, init?: { headers?: Record<string, string>; redirect?: "error" }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

const MAX_DISCOVERY_BYTES = 64 * 1024;

/**
 * Loads OpenID Provider metadata. Endpoints must share the issuer origin.
 * The JWKS URI is taken from config, not from metadata. Nothing runs until this is called.
 */
export async function fetchDiscovery(config: CentralOidcConfig, fetcher: FetchLike = fetch as FetchLike): Promise<OidcDiscovery> {
  const url = `${config.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const response = await fetcher(url, { headers: { accept: "application/json" }, redirect: "error" });
  if (!response.ok) {
    throw new CentralClientError("discovery_failed", `discovery returned ${response.status}`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_DISCOVERY_BYTES) {
    throw new CentralClientError("discovery_invalid", "discovery document too large");
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new CentralClientError("discovery_invalid", "discovery document is not JSON");
  }
  if (typeof doc !== "object" || doc === null) {
    throw new CentralClientError("discovery_invalid", "discovery document is not an object");
  }
  const record = doc as Record<string, unknown>;
  if (record.issuer !== config.issuer) {
    throw new CentralClientError("discovery_invalid", "discovery issuer mismatch");
  }
  const issuerOrigin = new URL(config.issuer).origin;
  const endpoint = (field: string): string => {
    let parsed: URL;
    try {
      parsed = parseStrictUrl(record[field], config.allowInsecureLocalhost, field);
    } catch {
      throw new CentralClientError("discovery_invalid", `${field} is not an allowed URL`);
    }
    if (parsed.origin !== issuerOrigin) {
      throw new CentralClientError("discovery_invalid", `${field} is outside the issuer origin`);
    }
    return parsed.href;
  };
  return Object.freeze({
    authorizationEndpoint: endpoint("authorization_endpoint"),
    tokenEndpoint: endpoint("token_endpoint"),
  });
}
