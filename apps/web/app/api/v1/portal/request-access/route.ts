import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { portalMagicLinkHtml } from "@ai-fsm/email-templates";
import { query } from "@/lib/db";
import { withTokenAccountContext } from "../../../_lib/account-context";
import { sendEmail, appUrl } from "@/lib/email/mailer";
import { normalizePhone } from "@/lib/phone";
import { isSmsGatewayConfigured, sendSmsViaGateway } from "@/lib/sms/gateway";
import { checkRateLimit, getClientIp, LOGIN_RATE_LIMIT } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { CLIENT_CAN_RECEIVE_REQUESTED_SMS_SQL } from "@/lib/sms/outbound";

const schema = z.union([
  z.object({ email: z.string().email() }),
  z.object({ phone: z.string().min(7).max(30) }),
]);

type ClientMatch = { id: string; name: string; can_text: boolean };

const BOOKING_ACCOUNT_ID_SCHEMA = z.string().uuid();

// Sign-in only ever resolves clients inside the live booking account. A missing
// or malformed setting returns null and the caller fails closed.
function getPortalAccountId(): string | null {
  const parsed = BOOKING_ACCOUNT_ID_SCHEMA.safeParse(process.env.BOOKING_ACCOUNT_ID?.trim());
  return parsed.success ? parsed.data : null;
}

// Lookups fetch at most two rows so a duplicate match can be detected. Zero or
// several matches mean no link is issued (fail closed).
function singleMatch(rows: ClientMatch[], traceId: string, channel: "email" | "phone"): ClientMatch | null {
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) {
    logger.warn("portal sign-in ambiguous match; no link issued", { traceId, channel });
  }
  return null;
}

// A client who texted STOP or opted out in the portal never gets a sign-in text.
const CAN_TEXT_SQL = CLIENT_CAN_RECEIVE_REQUESTED_SMS_SQL;

export async function POST(request: NextRequest) {
  const traceId = randomUUID();

  const rl = checkRateLimit(`portal-access:${getClientIp(request)}`, LOGIN_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests. Try again later.", traceId } },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Invalid request body", traceId } },
      { status: 400 }
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "A valid email address or phone number is required", traceId } },
      { status: 400 }
    );
  }

  // The historical-import account shares names/emails with live clients; only
  // the live (booking) account signs in. Without a valid account ID, issue nothing.
  const accountId = getPortalAccountId();
  if (!accountId) {
    logger.error("portal sign-in disabled: BOOKING_ACCOUNT_ID is missing or not a UUID", { traceId });
    return NextResponse.json({ ok: true });
  }

  if ("email" in parsed.data) {
    const email = parsed.data.email;
    // The account comes from server config (BOOKING_ACCOUNT_ID), not the request,
    // so the lookup runs inside that account's context.
    const matches = await withTokenAccountContext(accountId, async (tx) => {
      const { rows } = await tx.query<ClientMatch>(
        `SELECT c.id, c.name, ${CAN_TEXT_SQL} AS can_text FROM clients c
         WHERE lower(c.email) = lower($1) AND c.account_id = $2::uuid
         LIMIT 2`,
        [email, accountId]
      );
      return rows;
    });
    const client = singleMatch(matches, traceId, "email");
    if (client) {
      const verifyUrl = await createLoginLink(client.id);
      await sendEmail({
        to: email,
        subject: "Your Dovetails portal link",
        html: portalMagicLinkHtml(client.name, verifyUrl),
        text: [
          `Hi ${client.name},`,
          "",
          "Click the link below to access your Dovetails account portal.",
          "This link expires in 1 hour and can only be used once.",
          "",
          verifyUrl,
          "",
          "If you didn't request this, you can safely ignore this email.",
        ].join("\n"),
      });
    }
  } else {
    const phone = normalizePhone(parsed.data.phone);
    if (phone && isSmsGatewayConfigured()) {
      const last10 = phone.replace(/\D/g, "").slice(-10);
      const matches = await withTokenAccountContext(accountId, async (tx) => {
        const { rows } = await tx.query<ClientMatch>(
          `SELECT c.id, c.name, ${CAN_TEXT_SQL} AS can_text FROM clients c
           WHERE right(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), 10) = $1
             AND c.account_id = $2::uuid
           LIMIT 2`,
          [last10, accountId]
        );
        return rows;
      });
      const client = singleMatch(matches, traceId, "phone");
      if (client?.can_text) {
        const verifyUrl = await createLoginLink(client.id);
        // ponytail: not logged to communications_log — the body is a live login token.
        const sent = await sendSmsViaGateway({
          phone,
          message: `Dovetails: your sign-in link (expires in 1 hour): ${verifyUrl} Reply STOP to opt out.`,
        });
        if (!sent.ok) logger.warn("portal sign-in SMS failed", { traceId, error: sent.error });
      }
    }
  }

  // Always respond OK — don't reveal whether the email or phone is registered
  return NextResponse.json({ ok: true });
}

async function createLoginLink(clientId: string): Promise<string> {
  const links = await query<{ token: string }>(
    `INSERT INTO portal_magic_links (client_id, expires_at)
     VALUES ($1, now() + interval '1 hour')
     RETURNING token::text`,
    [clientId]
  );
  return `${appUrl()}/api/v1/portal/auth/verify?token=${links[0].token}`;
}
