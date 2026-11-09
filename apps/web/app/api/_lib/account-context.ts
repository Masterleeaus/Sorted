import type { PoolClient } from "pg";
import { getPool, queryOne } from "@/lib/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction whose RLS context is one account, for routes that
 * authenticate by token, invite or verified signature instead of a user session.
 *
 * The account id must come from the validated token, invite or signature record.
 * Never pass a value taken from the request body, query or path. Fails closed:
 * a missing or malformed account id throws before any connection is opened.
 * The role defaults to "public", so owner/admin-only policies do not match. A
 * caller that must write under an owner/admin-only policy (for example
 * booking_requests UPDATE) passes "owner" and must document why in the route.
 */
export async function withTokenAccountContext<T>(
  accountId: string | null | undefined,
  fn: (client: PoolClient) => Promise<T>,
  role: "public" | "owner" = "public",
): Promise<T> {
  if (!accountId || !UUID_RE.test(accountId)) {
    throw new Error("Account context missing: refusing to run tenant query");
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.current_user_id', '', true),
              set_config('app.current_account_id', $1, true),
              set_config('app.current_role', $2, true)`,
      [accountId, role],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The owner account for single-tenant internal prompts (HA start-day and
 * day-review). Resolved through the migration 204 resolver, because no account
 * context exists yet. Returns null when there is no owner.
 */
export async function resolveOwnerAccountId(): Promise<string | null> {
  const row = await queryOne<{ account_id: string | null }>(
    `SELECT resolve_owner_account_id() AS account_id`,
  );
  return row?.account_id ?? null;
}
