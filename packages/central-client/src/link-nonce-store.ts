/**
 * Single-use nonce tracking for link assertions on the Sorted side.
 * Ported from apps/web/lib/central/link-assertion.ts. Central enforces single use as well.
 * The in-memory store is for tests and single-process use only. Production needs a durable
 * store shared by all processes.
 */

export interface LinkNonceStore {
  /** Returns false when the nonce was already reserved. */
  reserve(nonce: string, expiresAtSeconds: number): Promise<boolean>;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createMemoryLinkNonceStore(now: () => number = nowSeconds): LinkNonceStore {
  const seen = new Map<string, number>();
  return {
    async reserve(nonce, expiresAtSeconds) {
      const current = now();
      for (const [key, expiry] of seen) {
        if (expiry <= current) seen.delete(key);
      }
      if (seen.has(nonce)) return false;
      seen.set(nonce, expiresAtSeconds);
      return true;
    },
  };
}
