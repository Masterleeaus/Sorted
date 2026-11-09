import type { SessionPayload } from "@/lib/auth/session";
import { withDbSession } from "@/lib/db";

export interface RequestIntakePhoto {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

/**
 * Photos linked to one booking request, for staff. Runs in one account-scoped DB
 * session. Returns null when the request is not in the session's account, so the
 * caller can answer 404 the same way for "missing" and "another account's".
 * Filenames and storage paths are not returned, and nothing here builds a URL.
 */
export async function listRequestIntakePhotos(
  session: SessionPayload,
  bookingRequestId: string,
): Promise<RequestIntakePhoto[] | null> {
  return withDbSession(session, async (client) => {
    const { rows: request } = await client.query<{ id: string }>(
      `SELECT id FROM booking_requests WHERE id = $1 AND account_id = $2`,
      [bookingRequestId, session.accountId],
    );
    if (request.length === 0) return null;

    const { rows } = await client.query<RequestIntakePhoto>(
      `SELECT m.id, m.original_name, m.mime_type, m.size_bytes, m.created_at
       FROM intake_media m
       JOIN booking_requests br ON br.id = m.booking_request_id AND br.account_id = m.account_id
       WHERE m.booking_request_id = $1 AND m.account_id = $2
       ORDER BY m.created_at`,
      [bookingRequestId, session.accountId],
    );
    return rows;
  });
}
