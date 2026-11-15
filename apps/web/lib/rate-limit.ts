/**
 * In-process sliding-window rate limiter.
 *
 * Uses a Map<key, number[]> where each value is an array of epoch-second
 * timestamps for recent requests. Expired entries are pruned on each access.
 *
 * This is appropriate for the current single-process standalone deployment
 * (VPS / Pi4). If multi-replica deployment is introduced, swap the store
 * for Redis sorted-set operations (see ADR-008 for details).
 */

import { isIP } from "node:net";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the sliding window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests remaining in current window (0 when denied) */
  remaining: number;
  /** Unix epoch seconds when the window resets for this key */
  resetAt: number;
}

/* ------------------------------------------------------------------ */
/*  In-process store                                                   */
/* ------------------------------------------------------------------ */

const store = new Map<string, number[]>();

// Periodically prune keys that have had no activity to prevent unbounded growth.
// 10-minute sweep is generous – idle keys naturally shrink on next access too.
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

let pruneTimer: ReturnType<typeof setInterval> | null = null;

function ensurePruneTimer(): void {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    for (const [key, timestamps] of store.entries()) {
      // Prune all entries (longest window we have is 15 min = 900 s)
      const fresh = timestamps.filter((t) => nowSeconds - t < 900);
      if (fresh.length === 0) {
        store.delete(key);
      } else {
        store.set(key, fresh);
      }
    }
  }, PRUNE_INTERVAL_MS);
  // Don't block process exit
  if (pruneTimer.unref) pruneTimer.unref();
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Check and increment the rate-limit counter for `key`.
 *
 * The counter is a sliding window: only requests within the last
 * `windowSeconds` are counted.
 *
 * @param key - Unique key, e.g. `login:${ip}` or `api:${ip}`
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  ensurePruneTimer();

  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = nowSeconds - config.windowSeconds;

  // Prune expired + append current
  const prev = (store.get(key) ?? []).filter((t) => t > windowStart);
  prev.push(nowSeconds);
  store.set(key, prev);

  const count = prev.length;
  const allowed = count <= config.limit;
  const remaining = Math.max(0, config.limit - count);
  // Reset time: when the oldest entry in the current window expires
  const oldest = prev[0] ?? nowSeconds;
  const resetAt = oldest + config.windowSeconds;

  return { allowed, remaining, resetAt };
}

/** Key used when the client address cannot be derived from a trusted hop. */
export const UNKNOWN_CLIENT_IP = "unknown";

/** Largest trusted-proxy count accepted from the environment. */
const MAX_TRUSTED_PROXY_COUNT = 10;

/**
 * Number of trusted proxy hops in front of the app, read from
 * `TRUSTED_PROXY_COUNT`. Defaults to 0 (forwarded headers are NOT trusted).
 * Missing, non-integer, negative or out-of-range values also resolve to 0,
 * so a bad value fails closed against spoofing.
 */
export function getTrustedProxyCount(): number {
  const raw = process.env.TRUSTED_PROXY_COUNT?.trim();
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const count = Number(raw);
  return count <= MAX_TRUSTED_PROXY_COUNT ? count : 0;
}

/**
 * Derive the client IP for rate-limit keys.
 *
 * Each trusted proxy appends the address of the peer it received the request
 * from to X-Forwarded-For. Entries to the left of those appended entries were
 * supplied by the client and are never trusted. With N trusted hops, the
 * client address is the entry N positions from the right end of the chain.
 *
 * Returns UNKNOWN_CLIENT_IP when:
 * - no trusted proxy is configured (count < 1),
 * - the header is missing or has fewer entries than trusted hops
 *   (the request did not pass through the expected proxies), or
 * - the selected entry is not a valid IPv4/IPv6 address.
 *
 * X-Real-IP is intentionally not read: it is a single value that is
 * client-controllable unless the edge overwrites it, and nothing in the repo
 * confirms that it does.
 *
 * @param trustedProxyCount - Defaults to the value of TRUSTED_PROXY_COUNT.
 */
export function getClientIp(
  request: Request,
  trustedProxyCount: number = getTrustedProxyCount()
): string {
  if (trustedProxyCount < 1) return UNKNOWN_CLIENT_IP;

  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return UNKNOWN_CLIENT_IP;

  const chain = forwarded.split(",").map((entry) => entry.trim());
  if (chain.length < trustedProxyCount) return UNKNOWN_CLIENT_IP;

  const candidate = chain[chain.length - trustedProxyCount];
  if (!isIP(candidate)) return UNKNOWN_CLIENT_IP;
  return candidate.toLowerCase();
}

/* ------------------------------------------------------------------ */
/*  Preset rate-limit configurations                                  */
/* ------------------------------------------------------------------ */

/** Login endpoint: 5 attempts per 15 minutes per IP */
export const LOGIN_RATE_LIMIT: RateLimitConfig = {
  limit: 5,
  windowSeconds: 15 * 60,
};

/** Sensitive mutations (transitions, payments): 30 requests/minute per IP */
export const SENSITIVE_RATE_LIMIT: RateLimitConfig = {
  limit: 30,
  windowSeconds: 60,
};

/** General API: 120 requests/minute per IP */
export const GENERAL_RATE_LIMIT: RateLimitConfig = {
  limit: 120,
  windowSeconds: 60,
};

/** Public booking form: 10 submissions per hour per IP */
export const BOOKING_RATE_LIMIT: RateLimitConfig = {
  limit: 10,
  windowSeconds: 60 * 60,
};

/** Public intake form (/api/intake/[token]): 20 requests per 15 minutes per IP */
export const INTAKE_IP_RATE_LIMIT: RateLimitConfig = {
  limit: 20,
  windowSeconds: 15 * 60,
};

/** Public intake form: 10 requests per 15 minutes per token (validity not revealed) */
export const INTAKE_TOKEN_RATE_LIMIT: RateLimitConfig = {
  limit: 10,
  windowSeconds: 15 * 60,
};

/** Public intake photo upload/remove: 60 requests per 15 minutes per IP (a household shares an IP) */
export const INTAKE_MEDIA_IP_RATE_LIMIT: RateLimitConfig = {
  limit: 60,
  windowSeconds: 15 * 60,
};

/** Public intake photo upload/remove: 30 requests per 15 minutes per token */
export const INTAKE_MEDIA_TOKEN_RATE_LIMIT: RateLimitConfig = {
  limit: 30,
  windowSeconds: 15 * 60,
};

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

/** Clear the in-process store. Test use only. */
export function _resetStore(): void {
  store.clear();
}
