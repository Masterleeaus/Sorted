import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { withTokenAccountContext } from "@/app/api/_lib/account-context";
import { getPortalSession, PREVIEW_READ_ONLY_MESSAGE } from "./session";

export interface PortalClient extends Record<string, unknown> {
  id: string;
  account_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  preferred_contact: string | null;
  sms_consent: boolean;
}

/**
 * Portal API guard: the portal token alone never authorizes anything — the
 * browser must hold a portal session for that same client. `write` requests
 * are refused during a staff preview (TASK-160).
 */
export async function requirePortalClient(
  clientToken: string,
  opts: { write: boolean },
): Promise<{ client: PortalClient } | { response: NextResponse }> {
  // The portal token resolves to an account first (migration 204); the client
  // row is then read inside that account's context.
  const resolved = await queryOne<{ account_id: string | null }>(
    `SELECT resolve_portal_client_account($1::uuid) AS account_id`,
    [clientToken],
  );
  const client = resolved?.account_id
    ? await withTokenAccountContext(resolved.account_id, async (tx) => {
        const { rows } = await tx.query<PortalClient>(
          `SELECT id::text, account_id::text, name, email, phone, preferred_contact, sms_consent
           FROM clients WHERE portal_token = $1 AND account_id = $2`,
          [clientToken, resolved.account_id],
        );
        return rows[0] ?? null;
      })
    : null;
  const session = await getPortalSession();
  if (!client || !session || session.clientId !== client.id) {
    return { response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  if (opts.write && session.isPreview) {
    return { response: NextResponse.json({ error: PREVIEW_READ_ONLY_MESSAGE }, { status: 403 }) };
  }
  return { client };
}
