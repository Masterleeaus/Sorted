import { Pool } from "pg";
import type { PoolClient } from "pg";
import { getEnv } from "./env";
import type { SessionPayload } from "./auth/session";

let pool: Pool | null = null;

/** A query target that is a pooled client or a transaction client. Helpers take one, never the bare pool. */
export type DbClient = Pick<PoolClient, "query">;

export function getPool(): Pool {
  if (!pool) {
    const env = getEnv();
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  }
  return pool;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const { rows } = await getPool().query<T>(text, params);
  return rows;
}

export async function queryOne<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates a company id (canonical tenant key, issue #26). Fails closed: a
 * missing or malformed value throws before any connection is opened.
 * During the dual-column period (migration 205) company_id equals account_id.
 */
export function assertCompanyId(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new Error("Company context missing: refusing to run tenant query");
  }
  return value;
}

/** Company id for a session. Taken from the same value as the account id. */
export function companyIdFromSession(session: SessionPayload): string {
  return assertCompanyId(session.accountId);
}

export async function withDbSession<T>(
  session: SessionPayload,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const companyId = companyIdFromSession(session);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.current_user_id', $1, true),
              set_config('app.current_account_id', $2, true),
              set_config('app.company_id', $3, true),
              set_config('app.current_role', $4, true)`,
      [session.userId, session.accountId, companyId, session.role],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function queryForSession<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  session: SessionPayload,
  text: string,
  params?: unknown[],
): Promise<T[]> {
  return withDbSession(session, async (client) => {
    const { rows } = await client.query<T>(text, params);
    return rows;
  });
}

export async function queryOneForSession<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  session: SessionPayload,
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await queryForSession<T>(session, text, params);
  return rows[0] ?? null;
}
