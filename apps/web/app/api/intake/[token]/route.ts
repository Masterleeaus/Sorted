import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import { logger } from "@/lib/logger";
import { scoreSiteVisitProbability } from "@ai-fsm/domain";
import {
  checkRateLimit,
  getClientIp,
  INTAKE_IP_RATE_LIMIT,
  INTAKE_TOKEN_RATE_LIMIT,
} from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Largest accepted request body. The schema caps the text fields well below this. */
const MAX_INTAKE_BODY_BYTES = 32 * 1024;

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  service_category: z.string().min(1),
  service_description: z.string().min(20).max(5000),
  intake_metadata: z.record(z.string()).default({}),
  address: z.string().max(200).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  zip: z.string().max(20).optional().or(z.literal("")),
  preferred_date: z.string().nullable().optional(),
  preferred_time_slot: z.enum(["morning", "afternoon", "evening", "flexible"]).default("flexible"),
  referral_source: z.string().nullable().optional(),
  referral_name: z.string().nullable().optional(),
  brokerage_name: z.string().nullable().optional(),
});

function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." } },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) },
    }
  );
}

/**
 * Read the request body with a hard byte cap, then parse it as JSON.
 * Rejects on the declared Content-Length first, then while streaming, so an
 * oversized body is never buffered in full.
 */
async function readJsonBody(
  request: NextRequest
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const tooLarge = () => ({
    ok: false as const,
    response: NextResponse.json(
      { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." } },
      { status: 413 }
    ),
  });
  const invalidJson = () => ({
    ok: false as const,
    response: NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Invalid request body" } },
      { status: 400 }
    ),
  });

  const declared = Number(request.headers.get("content-length"));
  if (request.headers.get("content-length") !== null && Number.isFinite(declared) && declared > MAX_INTAKE_BODY_BYTES) {
    return tooLarge();
  }

  const reader = request.body?.getReader();
  if (!reader) return invalidJson();

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_INTAKE_BODY_BYTES) {
        await reader.cancel();
        return tooLarge();
      }
      chunks.push(value);
    }
  } catch {
    return invalidJson();
  }

  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
  } catch {
    return invalidJson();
  }
}

/**
 * Response for a token that cannot be claimed. Used both when the pre-check
 * finds nothing usable and when the conditional claim matches zero rows.
 */
async function unavailableInviteResponse(pool: Pool, token: string): Promise<NextResponse> {
  // Check if it exists but is expired or used, to give a better message
  const { rows: checkRows } = await pool.query<{ used_at: string | null; expires_at: string }>(
    `SELECT used_at, expires_at FROM intake_invites WHERE token = $1`,
    [token]
  );
  if (checkRows[0]?.used_at) {
    return NextResponse.json({ error: { code: "ALREADY_USED", message: "This form has already been submitted." } }, { status: 409 });
  }
  if (checkRows[0]) {
    return NextResponse.json({ error: { code: "EXPIRED", message: "This link has expired. Please contact Dovetails Services for a new link." } }, { status: 410 });
  }
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Invalid intake link." } }, { status: 404 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Rate limits run before body parsing and before any database access. The
  // token limit uses a hash so raw tokens are not kept in process memory, and
  // it returns the same 429 whether or not the token is valid.
  const ipLimit = checkRateLimit(`intake-ip:${getClientIp(request)}`, INTAKE_IP_RATE_LIMIT);
  if (!ipLimit.allowed) {
    return rateLimitedResponse(ipLimit.resetAt - Math.floor(Date.now() / 1000));
  }
  const tokenKey = createHash("sha256").update(token).digest("hex");
  const tokenLimit = checkRateLimit(`intake-token:${tokenKey}`, INTAKE_TOKEN_RATE_LIMIT);
  if (!tokenLimit.allowed) {
    return rateLimitedResponse(tokenLimit.resetAt - Math.floor(Date.now() / 1000));
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parseResult = bodySchema.safeParse(bodyResult.body);
  if (!parseResult.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid form data", details: parseResult.error.flatten() } },
      { status: 400 }
    );
  }

  const input = parseResult.data;
  const pool = getPool();

  // Load the invite (only unused, non-expired). This read is not a claim: it
  // only resolves the account for RLS context. The claim below decides.
  const { rows: inviteRows } = await pool.query<{
    id: string; account_id: string; booking_request_id: string | null;
    lead_name: string; lead_email: string;
  }>(
    `SELECT id, account_id, booking_request_id, lead_name, lead_email
     FROM intake_invites
     WHERE token = $1 AND used_at IS NULL AND expires_at > now()`,
    [token]
  );

  if (!inviteRows[0]) {
    return unavailableInviteResponse(pool, token);
  }

  const invite = inviteRows[0];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Tenant context for RLS: the account is resolved from the token'd invite
    // above, so account-scoped write policies (intake_invites, booking_requests)
    // are satisfied under the restricted DB role. No-op as superuser today.
    await client.query(
      `SELECT set_config('app.current_account_id', $1, true),
              set_config('app.current_role', 'owner', true)`,
      [invite.account_id]
    );

    // Atomic claim. Concurrent submissions block on the row lock; once the
    // winner commits, the loser re-evaluates the predicate and matches nothing.
    // The claim is inside this transaction, so if the booking update below
    // fails, the rollback also releases the invite.
    const { rows: claimedRows } = await client.query<{ id: string }>(
      `UPDATE intake_invites SET used_at = now()
       WHERE id = $1 AND used_at IS NULL AND expires_at > now()
       RETURNING id`,
      [invite.id]
    );
    if (claimedRows.length === 0) {
      await client.query("ROLLBACK");
      return unavailableInviteResponse(pool, token);
    }

    // Re-score routing with the richer description
    const score = scoreSiteVisitProbability({
      service_category: input.service_category,
      service_description: input.service_description,
      intake_metadata: input.intake_metadata,
    });

    if (invite.booking_request_id) {
      // Update the existing booking request
      await client.query(
        `UPDATE booking_requests
         SET service_category = $1,
             service_description = $2,
             intake_metadata = $3,
             address = COALESCE($4, address),
             city = COALESCE($5, city),
             zip = COALESCE($6, zip),
             preferred_date = COALESCE($7::date, preferred_date),
             preferred_time_slot = $8,
             routing_path = $9,
             walkthrough_score = $10,
             name = $11,
             email = COALESCE(NULLIF($12, ''), email),
             phone = COALESCE(NULLIF($13, ''), phone),
             referral_source = COALESCE($15, referral_source),
             referral_name = COALESCE($16, referral_name),
             brokerage_name = COALESCE($17, brokerage_name),
             updated_at = now()
         WHERE id = $14`,
        [
          input.service_category,
          input.service_description,
          JSON.stringify(input.intake_metadata),
          input.address || null,
          input.city || null,
          input.zip || null,
          input.preferred_date || null,
          input.preferred_time_slot,
          score.path,
          score.score,
          input.name,
          input.email || null,
          input.phone || null,
          invite.booking_request_id,
          input.referral_source || null,
          input.referral_name || null,
          input.brokerage_name || null,
        ]
      );
    }

    await client.query("COMMIT");

    logger.info("intake submit: client completed intake form", {
      inviteId: invite.id,
      bookingRequestId: invite.booking_request_id,
      accountId: invite.account_id,
      routingPath: score.path,
      score: score.score,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("intake submit: error processing intake form", err as Error);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Failed to process intake. Please try again." } }, { status: 500 });
  } finally {
    client.release();
  }
}
