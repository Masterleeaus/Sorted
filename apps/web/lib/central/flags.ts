/**
 * Centrally governed feature flags, read by Sorted with a local default.
 *
 * Contract (Central docs/CONFIG.md, sections 3, 4 and 4.3):
 * - Every flag Sorted reads is declared here with a compiled-in default.
 * - Any failure (disabled reads, missing config, timeout, non-200, a fallback
 *   answer, a value of the wrong type) returns that default. Nothing throws
 *   into a request.
 * - Only a non-fallback 200 is cached, for at most 60 seconds.
 * - No tenant or cohort is ever sent: the organisation comes from Central's
 *   verified token.
 *
 * No flags are declared yet. Central's read endpoint is not live, so callers
 * get declared defaults. Add a declaration here only with the matching
 * Central declaration.
 */

import type { FetchLike } from "./oidc";
import type { ServiceTokenProvider } from "./service-client";

const FLAG_ENVIRONMENTS = ["development", "staging", "production"] as const;
type FlagEnvironment = (typeof FLAG_ENVIRONMENTS)[number];

const FLAG_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const READ_TIMEOUT_MS = 1_000;
const CACHE_MAX_MS = 60_000;

type FlagValue = boolean | string | number;

interface FlagSpec<T extends FlagValue> {
  readonly key: string;
  readonly default: T;
  readonly isValid: (value: unknown) => value is T;
}

function checkKey(key: string): string {
  if (!FLAG_KEY_RE.test(key)) throw new Error(`invalid flag key "${key}"`);
  return key;
}

export function booleanFlag(key: string, fallback: boolean): FlagSpec<boolean> {
  return {
    key: checkKey(key),
    default: fallback,
    isValid: (value): value is boolean => typeof value === "boolean",
  };
}

export function enumFlag<const V extends string>(key: string, values: readonly V[], fallback: V): FlagSpec<V> {
  if (new Set(values).size !== values.length || values.length === 0) throw new Error(`enum flag ${key} needs distinct values`);
  if (!values.includes(fallback)) throw new Error(`enum flag ${key} default is not an allowed value`);
  return {
    key: checkKey(key),
    default: fallback,
    isValid: (value): value is V => typeof value === "string" && (values as readonly string[]).includes(value),
  };
}

export function integerFlag(key: string, min: number, max: number, fallback: number): FlagSpec<number> {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) throw new Error(`integer flag ${key} has bad bounds`);
  if (!Number.isInteger(fallback) || fallback < min || fallback > max) throw new Error(`integer flag ${key} default out of bounds`);
  return {
    key: checkKey(key),
    default: fallback,
    isValid: (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max,
  };
}

type FlagSource = "central" | "default";

interface FlagResult<T extends FlagValue> {
  readonly value: T;
  readonly source: FlagSource;
}

interface FlagReaderDeps {
  readonly fetch: FetchLike;
  readonly tokens: ServiceTokenProvider | null;
  readonly origin: string | null;
  readonly enabled: boolean;
  readonly now?: () => number;
}

interface FlagReader {
  read<T extends FlagValue>(spec: FlagSpec<T>, environment: FlagEnvironment): Promise<FlagResult<T>>;
}

export function createFlagReader(deps: FlagReaderDeps): FlagReader {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { value: FlagValue; expiresAtMs: number }>();

  return {
    async read<T extends FlagValue>(spec: FlagSpec<T>, environment: FlagEnvironment): Promise<FlagResult<T>> {
      const fallback: FlagResult<T> = { value: spec.default, source: "default" };
      if (!FLAG_ENVIRONMENTS.includes(environment)) return fallback;
      if (!deps.enabled || !deps.tokens || !deps.origin) return fallback;

      const cacheKey = `${environment}:${spec.key}`;
      const hit = cache.get(cacheKey);
      if (hit && now() < hit.expiresAtMs && spec.isValid(hit.value)) {
        return { value: hit.value, source: "central" };
      }

      try {
        const token = await deps.tokens.getToken();
        const url = new URL(`/internal/v1/config/${environment}/${spec.key}`, deps.origin).toString();
        const res = await deps.fetch(url, {
          headers: { authorization: `Bearer ${token}`, accept: "application/json" },
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        });
        if (!res.ok) return fallback;
        const body = (await res.json()) as { key?: unknown; value?: unknown; source?: unknown };
        if (body.key !== spec.key || body.source === "fallback") return fallback;
        if (!spec.isValid(body.value)) return fallback;
        cache.set(cacheKey, { value: body.value, expiresAtMs: now() + CACHE_MAX_MS });
        return { value: body.value, source: "central" };
      } catch {
        return fallback;
      }
    },
  };
}
