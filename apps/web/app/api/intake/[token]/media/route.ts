/**
 * POST /api/intake/[token]/media — attach one photo to an open intake request.
 *
 * The invite token is the only credential. The account and invite are resolved
 * from the token before the body is read. The file is stored under a
 * server-generated name, and the row is written in the same transaction that
 * re-checks the invite and the photo cap.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  checkRateLimit,
  getClientIp,
  INTAKE_MEDIA_IP_RATE_LIMIT,
  INTAKE_MEDIA_TOKEN_RATE_LIMIT,
} from "@/lib/rate-limit";
import { payloadTooLargeResponse, readMultipartWithLimit, UPLOAD_BODY_LIMITS } from "@/lib/uploads/body-limit";
import { sanitizeDisplayName } from "@/lib/uploads/paths";
import { resolveOpenInvite } from "@/lib/intake/invite-access";
import { intakeMediaFilePath } from "@/lib/intake/media-storage";
import {
  INTAKE_PHOTO_EXTENSION,
  MAX_INTAKE_PHOTOS,
  sniffIntakePhotoMime,
  validateIntakePhotoMeta,
} from "@/lib/intake/photos";

export const dynamic = "force-dynamic";

function errorJson(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function rateLimited(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) } },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const ipLimit = checkRateLimit(`intake-media-ip:${getClientIp(request)}`, INTAKE_MEDIA_IP_RATE_LIMIT);
  if (!ipLimit.allowed) return rateLimited(ipLimit.resetAt - Math.floor(Date.now() / 1000));
  const tokenKey = createHash("sha256").update(token).digest("hex");
  const tokenLimit = checkRateLimit(`intake-media-token:${tokenKey}`, INTAKE_MEDIA_TOKEN_RATE_LIMIT);
  if (!tokenLimit.allowed) return rateLimited(tokenLimit.resetAt - Math.floor(Date.now() / 1000));

  const pool = getPool();
  const pre = await resolveOpenInvite(pool, token);
  if (!pre.ok) return pre.response;
  const invite = pre.invite;

  const multipart = await readMultipartWithLimit(request, UPLOAD_BODY_LIMITS.intakePhoto);
  if (!multipart.ok && multipart.reason === "too_large") {
    return payloadTooLargeResponse("", UPLOAD_BODY_LIMITS.intakePhoto);
  }
  if (!multipart.ok) return errorJson(422, "VALIDATION_ERROR", "Expected multipart form data");

  const entry = multipart.formData.get("file");
  if (!entry || typeof entry === "string") return errorJson(422, "VALIDATION_ERROR", "file is required");
  const file = entry as File;

  const metaError = validateIntakePhotoMeta({ type: file.type, size: file.size });
  if (metaError) return errorJson(422, "VALIDATION_ERROR", metaError);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffIntakePhotoMime(bytes);
  if (!mime) return errorJson(422, "VALIDATION_ERROR", "This file is not a supported photo.");
  // Both declared MIME and file signature must agree. A signature-only test
  // otherwise accepts a disguised image with misleading client metadata.
  if (mime !== file.type) {
    return errorJson(422, "VALIDATION_ERROR", "Photo type does not match its file contents.");
  }

  const filename = `${randomUUID()}.${INTAKE_PHOTO_EXTENSION[mime]}`;
  const filePath = intakeMediaFilePath(invite.id, filename);
  if (!filePath) return errorJson(500, "INTERNAL_ERROR", "Failed to save file");

  const client = await pool.connect();
  let written = false;
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.current_account_id', $1, true),
              set_config('app.current_role', 'owner', true)`,
      [invite.account_id],
    );

    // Lock the invite row so a submit and two photo adds cannot interleave the cap check.
    const { rows: locked } = await client.query<{ id: string }>(
      `SELECT id FROM intake_invites
       WHERE id = $1 AND used_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [invite.id],
    );
    if (locked.length === 0) {
      await client.query("ROLLBACK");
      return errorJson(404, "NOT_FOUND", "This link can no longer accept photos.");
    }

    const { rows: countRows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM intake_media WHERE intake_invite_id = $1`,
      [invite.id],
    );
    if ((countRows[0]?.n ?? 0) >= MAX_INTAKE_PHOTOS) {
      await client.query("ROLLBACK");
      return errorJson(422, "VALIDATION_ERROR", `You can attach up to ${MAX_INTAKE_PHOTOS} photos to one request.`);
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    // Exclusive creation prevents overwriting a pre-existing file, including
    // a symlink occupying the unpredictable generated filename.
    fs.writeFileSync(filePath, bytes, { flag: "wx", mode: 0o600 });
    written = true;

    const { rows } = await client.query<{
      id: string; original_name: string; mime_type: string; size_bytes: number;
    }>(
      `INSERT INTO intake_media
         (account_id, intake_invite_id, filename, original_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, original_name, mime_type, size_bytes`,
      [invite.account_id, invite.id, filename, sanitizeDisplayName(file.name), mime, bytes.byteLength],
    );

    await client.query("COMMIT");
    return NextResponse.json({ data: rows[0] }, { status: 201 });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (written) {
      try { fs.unlinkSync(filePath); } catch { /* already gone */ }
    }
    logger.error("[intake media POST] failed", err as Error);
    return errorJson(500, "INTERNAL_ERROR", "Failed to save photo. Please try again.");
  } finally {
    client.release();
  }
}
