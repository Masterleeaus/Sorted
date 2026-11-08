import { NextResponse } from "next/server";
import type { Pool } from "pg";

export interface OpenInvite {
  id: string;
  account_id: string;
  booking_request_id: string | null;
}

/**
 * Resolve an intake token to an unused, unexpired invite. The token is the only
 * credential; the account comes from the invite row. Responses for a missing,
 * used or expired token match the submit route's responses.
 */
export async function resolveOpenInvite(
  pool: Pick<Pool, "query">,
  token: string,
): Promise<{ ok: true; invite: OpenInvite } | { ok: false; response: NextResponse }> {
  const { rows } = await pool.query<OpenInvite>(
    `SELECT id, account_id, booking_request_id
     FROM intake_invites
     WHERE token = $1 AND used_at IS NULL AND expires_at > now()`,
    [token],
  );
  if (rows[0]) return { ok: true, invite: rows[0] };

  const { rows: check } = await pool.query<{ used_at: string | null }>(
    `SELECT used_at FROM intake_invites WHERE token = $1`,
    [token],
  );
  if (check[0]?.used_at) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "ALREADY_USED", message: "This form has already been submitted." } },
        { status: 409 },
      ),
    };
  }
  if (check[0]) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "EXPIRED", message: "This link has expired. Please contact Dovetails Services for a new link." } },
        { status: 410 },
      ),
    };
  }
  return {
    ok: false,
    response: NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Invalid intake link." } },
      { status: 404 },
    ),
  };
}
