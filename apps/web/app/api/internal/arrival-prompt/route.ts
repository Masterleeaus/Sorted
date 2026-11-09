import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { queryOne } from "@/lib/db";
import { withTokenAccountContext } from "../../_lib/account-context";

export const dynamic = "force-dynamic";

const KEY = process.env.LOCATION_INTERNAL_KEY;

const bodySchema = z.object({
  candidate_id: z.string().uuid(),
  action: z.literal("prompted"),
});

/**
 * HA Companion ack after sending an arrival push notification.
 * Stamps visit_candidates.live_prompted_at so we only interrupt once.
 */
export async function POST(req: NextRequest) {
  if (!KEY || req.headers.get("x-api-key") !== KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // The candidate resolves to its account through a bounded resolver (migration
  // 204). The ack then runs in that account's context as its owner, because the
  // visit_candidates UPDATE policy needs owner, admin or tech.
  const candidate = await queryOne<{ account_id: string | null }>(
    `SELECT resolve_visit_candidate_account($1::uuid) AS account_id`,
    [parsed.data.candidate_id],
  );
  if (!candidate?.account_id) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }
  const accountId = candidate.account_id;
  const rows = await withTokenAccountContext(accountId, async (tx) => {
    const { rows: updated } = await tx.query<{ id: string; live_prompted_at: string | null }>(
      `UPDATE visit_candidates
       SET live_prompted_at = COALESCE(live_prompted_at, now()), updated_at = now()
       WHERE id = $1 AND account_id = $2 AND status = 'pending'
       RETURNING id, live_prompted_at::text`,
      [parsed.data.candidate_id, accountId],
    );
    return updated;
  }, "owner");
  if (!rows[0]) {
    return NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, already: Boolean(rows[0].live_prompted_at) });
}
