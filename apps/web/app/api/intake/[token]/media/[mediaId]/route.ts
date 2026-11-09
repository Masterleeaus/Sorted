/**
 * DELETE /api/intake/[token]/media/[mediaId] — remove a photo before the intake is submitted.
 * Only rows on the invite that the token resolves to can be removed.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  checkRateLimit,
  getClientIp,
  INTAKE_MEDIA_IP_RATE_LIMIT,
  INTAKE_MEDIA_TOKEN_RATE_LIMIT,
} from "@/lib/rate-limit";
import { resolveOpenInvite } from "@/lib/intake/invite-access";
import { intakeMediaFilePath } from "@/lib/intake/media-storage";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rateLimited(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) } },
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; mediaId: string }> },
) {
  const { token, mediaId } = await params;

  const ipLimit = checkRateLimit(`intake-media-ip:${getClientIp(request)}`, INTAKE_MEDIA_IP_RATE_LIMIT);
  if (!ipLimit.allowed) return rateLimited(ipLimit.resetAt - Math.floor(Date.now() / 1000));
  const tokenKey = createHash("sha256").update(token).digest("hex");
  const tokenLimit = checkRateLimit(`intake-media-token:${tokenKey}`, INTAKE_MEDIA_TOKEN_RATE_LIMIT);
  if (!tokenLimit.allowed) return rateLimited(tokenLimit.resetAt - Math.floor(Date.now() / 1000));

  if (!UUID_RE.test(mediaId)) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Photo not found." } }, { status: 404 });
  }

  const pool = getPool();
  const pre = await resolveOpenInvite(pool, token);
  if (!pre.ok) return pre.response;
  const invite = pre.invite;

  const client = await pool.connect();
  let filename: string | null = null;
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.current_account_id', $1, true),
              set_config('app.current_role', 'owner', true)`,
      [invite.account_id],
    );
    // Serialize deletion with intake submission and uploads. A token resolved
    // before submission is not enough: the invite can be claimed meanwhile.
    const { rows: active } = await client.query<{ id: string }>(
      `SELECT id FROM intake_invites
       WHERE id = $1 AND account_id = $2 AND used_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [invite.id, invite.account_id],
    );
    if (active.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: { code: "ALREADY_USED", message: "This intake link no longer accepts edits." } },
        { status: 409 },
      );
    }
    const { rows } = await client.query<{ filename: string }>(
      `DELETE FROM intake_media
       WHERE id = $1 AND intake_invite_id = $2 AND account_id = $3
       RETURNING filename`,
      [mediaId, invite.id, invite.account_id],
    );
    await client.query("COMMIT");
    filename = rows[0]?.filename ?? null;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.error("[intake media DELETE] failed", err as Error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Could not remove the photo. Please try again." } },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  if (!filename) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Photo not found." } }, { status: 404 });
  }

  // The row is gone. A file that cannot be removed is logged for cleanup, not returned as an error.
  const filePath = intakeMediaFilePath(invite.id, filename);
  if (filePath) {
    try { fs.unlinkSync(filePath); } catch (err) {
      logger.warn("[intake media DELETE] file not removed", { err: String(err) });
    }
  }

  return NextResponse.json({ ok: true });
}
