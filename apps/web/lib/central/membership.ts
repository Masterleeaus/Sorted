/**
 * Database access for Central organisation memberships (migration 202).
 *
 * The login-time lookup goes through the SECURITY DEFINER resolver, because no
 * account context exists before a session is scoped. Every other read is made
 * under a session (queryOneForSession), so row-level security applies.
 */

import { queryOne, queryOneForSession } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth/session";
import type { MembershipRecord } from "./tenant";

type ResolverRow = {
  account_id: string;
  user_id: string;
  role: string;
  state: string;
  revision: number;
  [key: string]: unknown;
};

/** Resolves the membership for a verified Central subject and organisation. */
export async function lookupOrganisationMembership(
  subject: string,
  organisationId: string,
): Promise<MembershipRecord | null> {
  const row = await queryOne<ResolverRow>(
    `SELECT account_id, user_id, role, state, revision
       FROM resolve_organisation_membership($1, $2)`,
    [subject, organisationId],
  );
  if (!row) return null;
  return {
    accountId: row.account_id,
    userId: row.user_id,
    role: row.role,
    state: row.state,
    revision: Number(row.revision),
  };
}

/** Reads the stored membership state for a session, under that session's account scope. */
export async function readSessionMembership(
  session: SessionPayload,
  organisationId: string,
): Promise<{ state: string; revision: number } | null> {
  const row = await queryOneForSession<{ state: string; revision: number }>(
    session,
    `SELECT state, revision
       FROM organisation_memberships
      WHERE account_id = $1 AND user_id = $2 AND titan_organisation_id = $3`,
    [session.accountId, session.userId, organisationId],
  );
  return row ? { state: row.state, revision: Number(row.revision) } : null;
}
