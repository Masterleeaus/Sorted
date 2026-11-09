import { NextRequest, NextResponse } from "next/server";
import { withTokenAccountContext, resolveOwnerAccountId } from "../../_lib/account-context";
import { businessToday, businessMinutesNow } from "@/lib/operations/business-day";
import { sendPushToOwners } from "@/lib/push/send";

export const dynamic = "force-dynamic";

const KEY = process.env.LOCATION_INTERNAL_KEY;

export async function POST(req: NextRequest) {
  if (!KEY || req.headers.get("x-api-key") !== KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The owner account resolves through a bounded resolver (migration 204). The
  // business-day read and update run in that account's context as its owner.
  const accountId = await resolveOwnerAccountId();
  const row = accountId
    ? await withTokenAccountContext(accountId, async (tx) => {
        const { rows } = await tx.query<{
          account_id: string;
          business_day_id: string | null;
          cutoff_time: string;
          already_prompted: boolean;
        }>(
          `SELECT a.id AS account_id,
                  bd.id AS business_day_id,
                  a.day_review_cutoff_time::text AS cutoff_time,
                  (bd.review_prompted_at IS NOT NULL) AS already_prompted
           FROM accounts a
           JOIN users u ON u.account_id = a.id
           LEFT JOIN business_days bd
             ON bd.account_id = a.id
             AND bd.business_date = $1::date
             AND bd.status NOT IN ('CLOSED')
           WHERE u.role = 'owner' AND a.id = $2
           ORDER BY u.created_at LIMIT 1`,
          [businessToday(), accountId],
        );
        return rows[0] ?? null;
      }, "owner")
    : null;

  if (!row?.business_day_id) {
    return NextResponse.json({ result: "skipped", reason: "no_open_day" });
  }
  if (row.already_prompted) {
    return NextResponse.json({ result: "skipped", reason: "already_prompted" });
  }

  // cutoff_time is "HH:MM:SS" from postgres TIME cast — compare against the
  // business-timezone clock, not the server's (UTC in prod) getHours().
  const [cutoffHour, cutoffMin] = row.cutoff_time.split(":").map(Number);
  if (businessMinutesNow() < cutoffHour * 60 + cutoffMin) {
    return NextResponse.json({ result: "skipped", reason: "before_cutoff" });
  }

  const businessDayId = row.business_day_id;
  await withTokenAccountContext(row.account_id, async (tx) => {
    await tx.query(
      `UPDATE business_days SET review_prompted_at = now(), updated_at = now() WHERE id = $1`,
      [businessDayId],
    );
  }, "owner");

  await sendPushToOwners(row.account_id, {
    title: "Walk today’s stops",
    body: "Say what each stop was, plant tomorrow, then close the day.",
    url: "/app/day-review",
    tag: `day-review-${businessToday()}`,
  });

  return NextResponse.json({ result: "prompted" });
}
