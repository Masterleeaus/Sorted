import { notFound } from "next/navigation";
import { queryOne } from "@/lib/db";
import { withTokenAccountContext } from "@/app/api/_lib/account-context";
import { IntakeClientForm } from "./IntakeClientForm";

export const dynamic = "force-dynamic";

interface InviteRow {
  id: string;
  account_id: string;
  booking_request_id: string | null;
  token: string;
  lead_name: string;
  lead_email: string;
  lead_phone: string | null;
  expires_at: string;
  used_at: string | null;
}

export default async function PublicIntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Open invites resolve to an account through migration 204 (unused and unexpired).
  // The lead's phone is read inside that account's RLS context.
  let invite: InviteRow | null = null;
  let state: "open" | "used" | "expired" | "missing" = "missing";
  try {
    const open = await queryOne<{ id: string; account_id: string }>(
      `SELECT id, account_id FROM resolve_open_intake_invite($1::uuid)`,
      [token]
    );
    if (open) {
      state = "open";
      const rows = await withTokenAccountContext(open.account_id, (tx) =>
        tx
          .query<InviteRow>(
            `SELECT id, account_id, booking_request_id, token::text AS token,
                    lead_name, lead_email, lead_phone, expires_at, used_at
             FROM intake_invites
             WHERE id = $1 AND account_id = $2`,
            [open.id, open.account_id]
          )
          .then((r) => r.rows)
      );
      invite = rows[0] ?? null;
      if (!invite) state = "missing";
    } else {
      // Not open: the state resolver tells a used link from an expired or unknown one.
      const check = await queryOne<{ is_used: boolean }>(
        `SELECT is_used FROM resolve_intake_invite_state($1::uuid)`,
        [token]
      );
      state = check ? (check.is_used ? "used" : "expired") : "missing";
    }
  } catch {
    return (
      <div style={containerStyle}>
        <h1 style={headingStyle}>Something went wrong</h1>
        <p style={bodyStyle}>
          We couldn&apos;t load your intake form right now. Please try again in a moment,
          or contact Dovetails Services directly.
        </p>
      </div>
    );
  }

  if (state === "missing") return notFound();

  if (state === "used") {
    return (
      <div style={containerStyle}>
        <h1 style={headingStyle}>Already submitted</h1>
        <p style={bodyStyle}>
          This intake form has already been completed. We have your information and will be in touch soon.
        </p>
        <p style={mutedStyle}>
          Questions? Reply to the email we sent you or call us directly.
        </p>
      </div>
    );
  }

  if (state === "expired" || !invite) {
    return (
      <div style={containerStyle}>
        <h1 style={headingStyle}>Link expired</h1>
        <p style={bodyStyle}>
          This intake form link expired after 48 hours. Please contact Dovetails Services to request a new link.
        </p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={headingStyle}>Tell us about your project</h1>
        <p style={bodyStyle}>
          Hi {invite.lead_name}! Fill out a few details below so we can put together an accurate estimate for you.
          It only takes a couple of minutes.
        </p>
      </div>
      <IntakeClientForm
        token={invite.token}
        leadName={invite.lead_name}
        leadEmail={invite.lead_email}
        leadPhone={invite.lead_phone ?? ""}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  maxWidth: 560,
  margin: "40px auto",
  padding: "0 16px",
  fontFamily: "system-ui, sans-serif",
  color: "#18181b",
};

const headingStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  margin: "0 0 12px",
};

const bodyStyle: React.CSSProperties = {
  fontSize: 15,
  color: "#52525b",
  lineHeight: 1.6,
  margin: "0 0 8px",
};

const mutedStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#71717a",
  margin: "8px 0 0",
};
