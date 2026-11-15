import { createPublicKey, type KeyObject } from "node:crypto";
import { CentralClientError } from "./errors";
import type { FetchLike } from "./discovery";

export interface KeyResolver {
  getKey(kid: string): Promise<KeyObject>;
}

export interface JwksClientOptions {
  jwksUri: string;
  fetcher?: FetchLike;
  clock?: () => number;
  /** Minimum gap between refreshes triggered by an unknown kid. */
  refreshCooldownMs?: number;
}

const MAX_JWKS_BYTES = 256 * 1024;

/**
 * Caches RSA signing keys by kid. Refetches on an unknown kid only after the cooldown,
 * and coalesces concurrent refreshes into one request. Accepts RS256 keys only.
 */
export function createJwksClient({
  jwksUri,
  fetcher = fetch as FetchLike,
  clock = Date.now,
  refreshCooldownMs = 30_000,
}: JwksClientOptions): KeyResolver {
  const keys = new Map<string, KeyObject>();
  let lastFetchAt: number | null = null;
  let inFlight: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    const response = await fetcher(jwksUri, { headers: { accept: "application/json" }, redirect: "error" });
    if (!response.ok) {
      throw new CentralClientError("jwks_failed", `JWKS returned ${response.status}`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_JWKS_BYTES) {
      throw new CentralClientError("jwks_invalid", "JWKS too large");
    }
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      throw new CentralClientError("jwks_invalid", "JWKS is not JSON");
    }
    const list = (doc as { keys?: unknown } | null)?.keys;
    if (!Array.isArray(list)) {
      throw new CentralClientError("jwks_invalid", "JWKS has no keys array");
    }
    const next = new Map<string, KeyObject>();
    for (const jwk of list) {
      if (typeof jwk !== "object" || jwk === null) continue;
      const candidate = jwk as Record<string, unknown>;
      if (candidate.kty !== "RSA" || typeof candidate.kid !== "string") continue;
      if (candidate.use !== undefined && candidate.use !== "sig") continue;
      if (candidate.alg !== undefined && candidate.alg !== "RS256") continue;
      if (candidate.d !== undefined) continue; // never accept private key material
      try {
        next.set(candidate.kid, createPublicKey({ key: candidate as never, format: "jwk" }));
      } catch {
        // Unusable key entries are skipped; the kid is then reported as unknown.
      }
    }
    keys.clear();
    for (const [kid, key] of next) keys.set(kid, key);
  }

  function refreshOnce(): Promise<void> {
    if (!inFlight) {
      lastFetchAt = clock();
      inFlight = refresh().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  return {
    async getKey(kid: string): Promise<KeyObject> {
      const cached = keys.get(kid);
      if (cached) return cached;
      const now = clock();
      if (lastFetchAt !== null && now - lastFetchAt < refreshCooldownMs && !inFlight) {
        throw new CentralClientError("unknown_kid", "signing key not found");
      }
      await refreshOnce();
      const key = keys.get(kid);
      if (!key) throw new CentralClientError("unknown_kid", "signing key not found");
      return key;
    },
  };
}
