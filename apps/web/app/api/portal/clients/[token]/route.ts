import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { withTokenAccountContext } from "../../../_lib/account-context";

export const dynamic = "force-dynamic";

interface ClientRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  name: string;
  email: string;
  account_name: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Bootstrap: the portal token resolves to an account through a bounded
  // resolver (migration 204). Nothing else runs before account context is set.
  const resolved = await queryOne<{ account_id: string | null }>(
    `SELECT resolve_portal_client_account($1::uuid) AS account_id`,
    [token]
  );
  if (!resolved?.account_id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const accountId = resolved.account_id;

  // Every read below runs in the client's account context, with the account predicate kept.
  const loaded = await withTokenAccountContext(
    accountId,
    async (tx) => {
      const { rows: [client] } = await tx.query<ClientRow>(
        `SELECT c.id, c.account_id, c.name, c.email, a.name AS account_name
         FROM clients c
         JOIN accounts a ON a.id = c.account_id
         WHERE c.portal_token = $1 AND c.account_id = $2`,
        [token, accountId]
      );
      if (!client) return null;
      const estimates = await tx.query(
        `SELECT e.id, e.status, e.total_cents, e.sent_at, e.expires_at,
                e.share_token, p.address AS property_address
         FROM estimates e
         LEFT JOIN properties p ON p.id = e.property_id
         WHERE e.client_id = $1 AND e.account_id = $2 AND e.status != 'draft'
         ORDER BY e.created_at DESC`,
        [client.id, client.account_id]
      );
      const invoices = await tx.query(
        `SELECT i.id, i.invoice_number, i.status, i.total_cents, i.paid_cents,
                i.due_date, i.share_token, p.address AS property_address
         FROM invoices i
         LEFT JOIN properties p ON p.id = i.property_id
         WHERE i.client_id = $1 AND i.account_id = $2 AND i.status != 'draft'
         ORDER BY i.created_at DESC`,
        [client.id, client.account_id]
      );
      const plans = await tx.query(
        `SELECT id, name, frequency, services, price_cents, status, next_scheduled_date, notes
         FROM maintenance_plans
         WHERE client_id = $1 AND account_id = $2
         ORDER BY status, created_at DESC`,
        [client.id, client.account_id]
      );
      const maintenanceJobs = await tx.query(
        `SELECT j.id, j.title, j.status,
                p.address AS property_address,
                MAX(v.completed_at)::text AS completed_at,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'id', v.id, 'status', v.status, 'completed_at', v.completed_at,
                      'tech_notes', v.tech_notes
                    ) ORDER BY v.scheduled_start
                  ) FILTER (WHERE v.id IS NOT NULL),
                  '[]'
                ) AS visits
         FROM jobs j
         LEFT JOIN properties p ON p.id = j.property_id
         LEFT JOIN visits v ON v.job_id = j.id
         WHERE j.client_id = $1 AND j.account_id = $2 AND j.job_type = 'maintenance' AND j.status = 'completed'
         GROUP BY j.id, p.address
         ORDER BY MAX(v.completed_at) DESC NULLS LAST
         LIMIT 20`,
        [client.id, client.account_id]
      );
      return {
        client,
        estimates: estimates.rows,
        invoices: invoices.rows,
        plans: plans.rows,
        maintenanceJobs: maintenanceJobs.rows,
      };
    }
  );
  if (!loaded) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { client, estimates, invoices, plans, maintenanceJobs } = loaded;

  return NextResponse.json({
    client: { name: client.name, email: client.email, accountName: client.account_name },
    estimates,
    invoices,
    plans,
    maintenanceJobs,
  });
}
