import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { sendEmail, appUrl } from "@/lib/email/mailer";
import { portalMagicLinkHtml as magicLinkHtml } from "@/lib/email/portal-magic-link";
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
  // the live (booking) account signs in when it is configured.
  const accountId = process.env.BOOKING_ACCOUNT_ID || null;

  if ("email" in parsed.data) {
    const email = parsed.data.email;
    const [client] = await query<ClientMatch>(
      `SELECT c.id, c.name, ${CAN_TEXT_SQL} AS can_text FROM clients c
       WHERE lower(c.email) = lower($1) AND ($2::uuid IS NULL OR c.account_id = $2)
       ORDER BY c.created_at LIMIT 1`,
      [email, accountId]
    );
    if (client) {
      const verifyUrl = await createLoginLink(client.id);
      await sendEmail({
        to: email,
        subject: "Your Dovetails portal link",
        html: magicLinkHtml(client.name, verifyUrl),
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
      const [client] = await query<ClientMatch>(
        `SELECT c.id, c.name, ${CAN_TEXT_SQL} AS can_text FROM clients c
         WHERE right(regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g'), 10) = $1
           AND ($2::uuid IS NULL OR c.account_id = $2)
         ORDER BY c.created_at LIMIT 1`,
        [last10, accountId]
      );
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

