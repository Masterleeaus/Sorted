import type { PoolClient } from "pg";
import { queryOne } from "@/lib/db";
import { withTokenAccountContext } from "@/app/api/_lib/account-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The migration 204 resolvers that map a public token to its account. Only these
 * three names are accepted, so the SQL below never interpolates request input.
 */
export type PortalTokenResolver =
  | "resolve_portal_client_account"
  | "resolve_estimate_share_account"
  | "resolve_invoice_share_account";

/**
 * Page-side twin of the API routes' token bootstrap. Resolves a portal or share
 * token to its account first, then runs `fn` in that account's RLS context
 * (withTokenAccountContext). Returns null when the token is malformed or matches
 * no row, so the page can call notFound() and fail closed before any tenant read.
 */
export async function withPortalTokenPage<T>(
  resolver: PortalTokenResolver,
  token: string,
  fn: (tx: PoolClient, accountId: string) => Promise<T>,
): Promise<T | null> {
  if (!UUID_RE.test(token)) return null;
  const resolved = await queryOne<{ account_id: string | null }>(
    `SELECT ${resolver}($1::uuid) AS account_id`,
    [token],
  );
  const accountId = resolved?.account_id ?? null;
  if (!accountId) return null;
  return withTokenAccountContext(accountId, (tx) => fn(tx, accountId));
}
