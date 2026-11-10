import { notFound } from "next/navigation";
import { loadSquareSettings } from "@/lib/integrations/square-payments";
import { recordInvoicePortalView } from "@/lib/invoices/client-view";
import { isPortalPreview } from "@/lib/portal/session";
import { withPortalTokenPage } from "@/lib/portal/token-page";
import { getSession } from "@/lib/auth/session";
import { InvoicePortalClient } from "./InvoicePortalClient";
import {
  SPONSORED_DOCUMENT_JOIN,
  SPONSORED_DOCUMENT_SELECT,
  sponsoredDocumentInfo,
} from "@/lib/invoices/sponsored";

export const dynamic = "force-dynamic";

interface InvoiceRow extends Record<string, unknown> {
  id: string;
  account_id: string;
  status: string;
  invoice_number: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  deposit_cents: number | null;
  deposit_type: string | null;
  deposit_percentage: number | null;
  deposit_fixed_cents: number | null;
  notes: string | null;
  work_summary: string | null;
  show_itemized_receipts: boolean;
  due_date: string | null;
  paid_at: string | null;
  client_name: string;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  account_name: string;
  account_settings: { invoice_terms?: string; deposit_percent?: number; deposit_terms?: string };
  invoice_kind: string;
  job_status: string | null;
}

interface LineItemRow extends Record<string, unknown> {
  id: string;
  description: string;
  quantity: string;
  unit_price_cents: number;
  total_cents: number;
  sort_order: number;
}

export default async function InvoicePortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // The share token resolves to an account first (migration 204). The invoice and its
  // line items are read in that account's RLS context.
  const loaded = await withPortalTokenPage("resolve_invoice_share_account", token, async (tx, accountId) => {
    const q = <T extends Record<string, unknown>>(text: string, params?: unknown[]) =>
      tx.query<T>(text, params).then((r) => r.rows);
    const rows = await q<InvoiceRow>(
      `SELECT
         i.id, i.account_id, i.client_id, i.status, i.invoice_number, i.subtotal_cents, i.tax_cents,
         i.total_cents, i.paid_cents, i.deposit_cents, i.notes, i.due_date,
         i.work_summary, i.show_itemized_receipts,
         i.paid_at, i.deposit_type, i.deposit_percentage, i.deposit_fixed_cents,
         i.invoice_kind, j.status AS job_status,
         c.name AS client_name,
         p.address AS property_address, p.city AS property_city,
         p.state AS property_state, p.zip AS property_zip,
         a.name AS account_name, a.settings AS account_settings,
         ${SPONSORED_DOCUMENT_SELECT}
       FROM invoices i
       JOIN clients c ON c.id = i.client_id
       JOIN accounts a ON a.id = i.account_id
       ${SPONSORED_DOCUMENT_JOIN}
       LEFT JOIN jobs j ON j.id = i.job_id
       LEFT JOIN properties p ON p.id = i.property_id
       WHERE i.share_token = $1 AND i.account_id = $2`,
      [token, accountId]
    );
    const invoice = rows[0] ?? null;
    if (!invoice) return null;

    const lineItems = await q<LineItemRow>(
      `SELECT id, description, quantity, unit_price_cents, total_cents, sort_order
       FROM invoice_line_items
       WHERE invoice_id = $1 AND visible_to_customer = true
       ORDER BY sort_order`,
      [invoice.id]
    );
    return { invoice, lineItems };
  });

  if (!loaded) notFound();
  const { invoice, lineItems } = loaded;

  // TASK-160: staff (admin preview, or a logged-in owner opening the link) are
  // not the client — never mark the invoice opened. A preview also cannot pay.
  const [preview, staffSession] = await Promise.all([
    isPortalPreview(invoice.client_id as string),
    getSession(),
  ]);
  const staffViewer = preview || staffSession?.accountId === invoice.account_id;

  // Best-effort: stamp client open so owners see Unread vs Viewed + attention feed.
  // Never block the portal render if the stamp fails.
  if (!staffViewer) try {
    const view = await withPortalTokenPage("resolve_invoice_share_account", token, async (tx) => {
      const stamp = await recordInvoicePortalView(
        async (sql, params) => {
          const r = await tx.query(sql, params as unknown[]);
          return { rowCount: r.rowCount, rows: r.rows };
        },
        token,
      );
      return stamp;
    });
    if (view?.firstOpen && view.invoice) {
      const { emitAttentionEvent } = await import("@/lib/attention");
      const attention = view.invoice;
      await withPortalTokenPage("resolve_invoice_share_account", token, (tx) =>
        emitAttentionEvent(tx, {
          accountId: attention.account_id,
          type: "invoice.opened",
          entityType: "invoice",
          entityId: attention.id,
          title: "Invoice opened",
          summary: [
            attention.invoice_number,
            attention.client_name,
          ]
            .filter(Boolean)
            .join(" · "),
          href: `/app/invoices/${attention.id}`,
          dedupeKey: `invoice.opened:${attention.id}`,
        }),
      );
    }
  } catch {
    // ignore — view tracking is advisory
  }

  // Online card payment is offered only when the account has Square configured.
  let onlinePaymentAvailable = false;
  if (!preview) {
    const square = await withPortalTokenPage("resolve_invoice_share_account", token, (tx, accountId) =>
      loadSquareSettings(tx, accountId),
    );
    onlinePaymentAvailable =
      !!square?.enabled &&
      !!square.secrets.accessToken &&
      !!square.config.locationId;
  }

  return (
    <InvoicePortalClient
      token={token}
      invoice={invoice}
      lineItems={lineItems}
      onlinePaymentAvailable={onlinePaymentAvailable}
      sponsored={sponsoredDocumentInfo(invoice)}
    />
  );
}
