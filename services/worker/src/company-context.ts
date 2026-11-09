/**
 * Company context for per-account worker jobs (issue #26).
 *
 * Sets app.company_id for the duration of one transaction, so a per-account job
 * can run its statements under a company id. Kept local to the worker: the worker
 * image does not ship @ai-fsm/domain (see invoice-followup.ts).
 *
 * The worker role is BYPASSRLS (ADR-024), so this setting does not enforce
 * isolation by itself. Each job must still scope its SQL by company_id or account_id.
 * No sweep uses this helper yet.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QueryClient = { query: (text: string, params?: unknown[]) => Promise<unknown> };

/** Fails closed: a missing or malformed company id throws before any SQL runs. */
export function assertCompanyId(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new Error("Company context missing: refusing to run tenant job");
  }
  return value;
}

/**
 * Runs `fn` in a transaction with app.company_id set. Rolls back and rethrows
 * when `fn` fails. Do not nest inside another open transaction on the same client.
 */
export async function runInCompanyContext<T>(
  client: QueryClient,
  companyId: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const id = assertCompanyId(companyId);
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.company_id', $1, true)", [id]);
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
