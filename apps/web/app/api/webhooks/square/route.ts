import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { logger } from "@/lib/logger";
import { decryptJson } from "@/lib/crypto";
import { verifySquareWebhook, type SquareSecrets } from "@/lib/integrations/square-payments";

export const dynamic = "force-dynamic";

// === POST /api/webhooks/square ===
// Handles payment.created / payment.updated and refund.created / refund.updated.
// Square delivers events at-least-once, so processing is idempotent via the
// unique index on (external_provider, external_payment_id). The app DB role
// bypasses RLS, so no session context is set on this unauthenticated endpoint.

interface SquarePaymentObject {
  id?: string;
  status?: string; // APPROVED | COMPLETED | CANCELED | FAILED
  order_id?: string;
  location_id?: string;
  amount_money?: { amount?: number; currency?: string };
}

interface SquareRefundObject {
  id?: string;
  status?: string; // PENDING | COMPLETED | REJECTED | FAILED
  payment_id?: string;
  order_id?: string;
  location_id?: string;
  amount_money?: { amount?: number; currency?: string };
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-square-hmacsha256-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Parse untrusted body just enough to locate the account (by location_id) so
  // we can fetch the right signing key, then verify before acting on anything.
  let event: {
    type?: string;
    data?: { object?: { payment?: SquarePaymentObject; refund?: SquareRefundObject } };
  };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payment = event.data?.object?.payment;
  const refund = event.data?.object?.refund;
  // location_id appears on whichever object the event carries.
  const locationId = payment?.location_id ?? refund?.location_id;
  if (!locationId) {
    // Not an event we handle — ack so Square stops retrying.
    return NextResponse.json({ received: true });
  }

  const pool = getPool();

  // Bootstrap: resolves the account and signing key from the location id before
  // any account context exists. Stays cross-account until a bounded resolver
  // exists (docs/working/rls-web-tier-flip.md, blocker 2).
  const settingsRow = await pool.query<{
    account_id: string;
    enabled: boolean;
    secrets: Buffer | null;
    webhook_url: string | null;
  }>(
    `SELECT account_id, enabled, secrets, config->>'webhookUrl' AS webhook_url
     FROM integration_settings
     WHERE provider = 'square' AND config->>'locationId' = $1`,
    [locationId]
  );
  if (settingsRow.rowCount === 0) {
    logger.error("Square webhook: no account for location", { locationId });
    return NextResponse.json({ received: true });
  }
  const { account_id, secrets, webhook_url } = settingsRow.rows[0];
  const decrypted: SquareSecrets = secrets
    ? decryptJson<SquareSecrets>(secrets)
    : { accessToken: null, webhookSignatureKey: null };

  if (!decrypted.webhookSignatureKey) {
    logger.error("Square webhook: no signature key configured", { account_id });
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }

  // Verify against the registered notification URL. Prefer the value saved in
  // the Square settings panel; fall back to an env override, then request.url.
  const notificationUrl =
    webhook_url || process.env.SQUARE_WEBHOOK_URL || request.url;
  const valid = await verifySquareWebhook({
    body,
    signature,
    signatureKey: decrypted.webhookSignatureKey,
    notificationUrl,
  });
  if (!valid) {
    logger.error("Square webhook: signature verification failed", { account_id });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const isPaymentEvent =
    event.type === "payment.created" || event.type === "payment.updated";
  const isRefundEvent =
    event.type === "refund.created" || event.type === "refund.updated";

  try {
    if (isPaymentEvent && payment?.status === "COMPLETED" && payment.id) {
      await handleCompletedPayment(pool, account_id, payment);
    } else if (isRefundEvent && refund?.status === "COMPLETED" && refund.id) {
      await handleCompletedRefund(pool, account_id, refund);
    }
  } catch (err) {
    logger.error("Square webhook: failed to process event", err);
    return NextResponse.json({ error: "Event processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// Square payment links are always priced in USD (see createSquarePaymentLink).
const SQUARE_LINK_CURRENCY = "USD";

interface PendingSquareRow {
  id: string;
  invoice_id: string;
  amount_cents: number;
}

// Record a payment we could not safely apply. The row is written inside the
// same transaction as the decision, so it survives the COMMIT and is visible
// for reconciliation. Square still gets a 200, so it does not retry.
async function quarantineSquarePayment(
  client: PoolClient,
  accountId: string,
  payment: SquarePaymentObject,
  reason: string,
  target: { paymentRowId?: string; invoiceId?: string }
): Promise<void> {
  const entityType = target.paymentRowId ? "payment" : target.invoiceId ? "invoice" : "account";
  const entityId = target.paymentRowId ?? target.invoiceId ?? accountId;
  await client.query(
    `INSERT INTO workflow_events (account_id, event_type, entity_type, entity_id, payload)
     VALUES ($1, 'payment.square_quarantined', $2, $3, $4)`,
    [
      accountId,
      entityType,
      entityId,
      JSON.stringify({
        reason,
        squarePaymentId: payment.id,
        squareOrderId: payment.order_id ?? null,
        squareAmountCents: payment.amount_money?.amount ?? null,
        squareCurrency: payment.amount_money?.currency ?? null,
        source: "square_webhook",
      }),
    ]
  );
  logger.error("Square webhook: payment quarantined for reconciliation", {
    reason,
    paymentId: payment.id,
    orderId: payment.order_id ?? null,
  });
}

// Mark the pending Square payment row for this payment's order paid, then emit
// payment.recorded and, if the invoice cleared, invoice.paid. Anything that does
// not match a pending row with the same amount and currency is quarantined and
// left unpaid.
async function handleCompletedPayment(
  pool: { connect: () => Promise<PoolClient> },
  accountId: string,
  payment: SquarePaymentObject
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setWebhookAccountContext(client, accountId);

    // Serialize all deliveries of this Square payment. A concurrent duplicate
    // waits here, so the duplicate check below cannot race a sibling transaction.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `square-payment:${payment.id}`,
    ]);

    // Idempotency: bail if we've already recorded this Square payment.
    const dup = await client.query(
      `SELECT 1 FROM payments
       WHERE account_id = $1 AND external_provider = 'square' AND external_payment_id = $2`,
      [accountId, payment.id]
    );
    if (dup.rowCount && dup.rowCount > 0) {
      await client.query("COMMIT");
      logger.info("Square webhook: duplicate payment ignored", { paymentId: payment.id });
      return;
    }

    const orderId = payment.order_id ?? null;

    // 1. Exact match: the pending row created for this Square order (one per link).
    //    FOR UPDATE + status check makes the transition atomic per row.
    let row: PendingSquareRow | undefined;
    if (orderId) {
      const exact = await client.query<PendingSquareRow>(
        `SELECT id, invoice_id, amount_cents
         FROM payments
         WHERE account_id = $1 AND external_provider = 'square'
           AND external_order_id = $2 AND status = 'pending'
         FOR UPDATE`,
        [accountId, orderId]
      );
      row = exact.rows[0];
    }

    // 2. Legacy fallback: pending rows created before external_order_id existed.
    //    Only the invoice's current order can be identified, and only when it is
    //    the single unmatched legacy row. Anything ambiguous is quarantined.
    if (!row && orderId) {
      const legacy = await client.query<PendingSquareRow>(
        `SELECT p.id, p.invoice_id, p.amount_cents
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id
         WHERE i.account_id = $1 AND i.square_order_id = $2
           AND p.external_provider = 'square' AND p.status = 'pending'
           AND p.external_order_id IS NULL AND p.external_payment_id IS NULL
         FOR UPDATE OF p`,
        [accountId, orderId]
      );
      if (legacy.rowCount === 1) row = legacy.rows[0];
    }

    if (!row) {
      const inv = await client.query<{ id: string }>(
        `SELECT id FROM invoices WHERE account_id = $1 AND square_order_id = $2`,
        [accountId, orderId ?? ""]
      );
      await quarantineSquarePayment(client, accountId, payment, "no_pending_link", {
        invoiceId: inv.rows[0]?.id,
      });
      await client.query("COMMIT");
      return;
    }

    // 3. Verify the signed event against the pending row before marking it paid.
    const squareAmount = payment.amount_money?.amount;
    const squareCurrency = payment.amount_money?.currency;
    const mismatch =
      squareAmount !== row.amount_cents
        ? "amount_mismatch"
        : squareCurrency !== SQUARE_LINK_CURRENCY
          ? "currency_mismatch"
          : null;
    if (mismatch) {
      await quarantineSquarePayment(client, accountId, payment, mismatch, {
        paymentRowId: row.id,
        invoiceId: row.invoice_id,
      });
      await client.query("COMMIT");
      return;
    }

    // 4. Conditional transition: only a row still pending can become paid.
    const upd = await client.query<{ id: string }>(
      `UPDATE payments
       SET status = 'paid', external_payment_id = $2,
           paid_at = now(), received_at = now()
       WHERE id = $1 AND account_id = $3 AND status = 'pending'
       RETURNING id`,
      [row.id, payment.id, accountId]
    );
    if (upd.rowCount === 0) {
      await client.query("COMMIT");
      logger.info("Square webhook: pending row already settled", { paymentId: payment.id });
      return;
    }

    const invoiceId = row.invoice_id;
    const amountCents = row.amount_cents;
    const paymentRowId = upd.rows[0].id;

    // Daily Operations Log: payment recorded, and invoice.paid if cleared.
    await client.query(
      `INSERT INTO workflow_events (account_id, event_type, entity_type, entity_id, payload)
       VALUES ($1, 'payment.recorded', 'payment', $2, $3)`,
      [
        accountId,
        paymentRowId,
        JSON.stringify({ invoiceId, amountCents, method: "square", source: "square_webhook" }),
      ]
    );
    const inv = await client.query<{ status: string; invoice_number: string }>(
      `SELECT status, invoice_number FROM invoices WHERE id = $1 AND account_id = $2`,
      [invoiceId, accountId]
    );
    if (inv.rows[0]?.status === "paid") {
      await client.query(
        `INSERT INTO workflow_events (account_id, event_type, entity_type, entity_id, payload)
         VALUES ($1, 'invoice.paid', 'invoice', $2, $3)`,
        [accountId, invoiceId, JSON.stringify({ amountCents, method: "square" })]
      );
      const jobLink = await client.query<{ job_id: string | null; created_by: string }>(
        `SELECT job_id, created_by FROM invoices WHERE id = $1 AND account_id = $2`,
        [invoiceId, accountId],
      );
      if (jobLink.rows[0]?.job_id) {
        const { closeJobIfFullyPaid } = await import("@/lib/jobs/close-if-paid");
        await closeJobIfFullyPaid(client, {
          accountId,
          jobId: jobLink.rows[0].job_id,
          actorId: jobLink.rows[0].created_by,
        });
      }
    }
    // Owner attention (in-app + optional email via queue)
    if (inv.rows[0] && (inv.rows[0].status === "paid" || inv.rows[0].status === "partial")) {
      try {
        const { emitInvoicePaymentAttention } = await import("@/lib/attention");
        await emitInvoicePaymentAttention(client, {
          accountId,
          invoiceId,
          invoiceNumber: inv.rows[0].invoice_number,
          status: inv.rows[0].status,
          paymentId: paymentRowId,
        });
      } catch (attErr) {
        logger.error("Square webhook: attention emit failed (non-fatal)", attErr);
      }
    }

    await client.query("COMMIT");
    logger.info("Square payment recorded", { invoiceId, amountCents });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Sets the RLS context for a verified Square event. The account comes from the
 * signed settings record resolved by location id, never from the request body.
 * Role is owner: payments and invoices writes need owner or admin under RLS.
 * See the report for the review of this role.
 */
async function setWebhookAccountContext(client: PoolClient, accountId: string): Promise<void> {
  await client.query(
    `SELECT set_config('app.current_user_id', '', true),
            set_config('app.current_account_id', $1, true),
            set_config('app.current_role', 'owner', true)`,
    [accountId]
  );
}

// Record a Square-initiated refund as a ledger-only payment row (status
// 'refunded', payment_type 'refund'). The sync trigger ignores non-'paid' rows,
// so paid_cents is unchanged — matching manual refund semantics. Linked to the
// invoice via the original payment (refund.payment_id) or the order id.
async function handleCompletedRefund(
  pool: { connect: () => Promise<PoolClient> },
  accountId: string,
  refund: SquareRefundObject
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setWebhookAccountContext(client, accountId);

    // Idempotency: refund.id is distinct from the payment id; the unique index
    // on (external_provider, external_payment_id) also guards the INSERT.
    const dup = await client.query(
      `SELECT 1 FROM payments
       WHERE account_id = $1 AND external_provider = 'square' AND external_payment_id = $2`,
      [accountId, refund.id]
    );
    if (dup.rowCount && dup.rowCount > 0) {
      await client.query("COMMIT");
      logger.info("Square webhook: duplicate refund ignored", { refundId: refund.id });
      return;
    }

    // Resolve the invoice + attribution. Prefer the original payment row
    // (refund.payment_id); fall back to matching the invoice by order id.
    const orig = await client.query<{
      invoice_id: string;
      account_id: string;
      client_id: string | null;
      job_id: string | null;
      created_by: string;
    }>(
      `SELECT p.invoice_id, p.account_id, p.customer_id AS client_id, p.job_id,
              i.created_by
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE p.account_id = $2 AND i.account_id = $2
         AND p.external_provider = 'square' AND p.external_payment_id = $1`,
      [refund.payment_id ?? "", accountId]
    );

    let target = orig.rows[0];
    if (!target) {
      const inv = await client.query<{
        invoice_id: string;
        account_id: string;
        client_id: string;
        job_id: string | null;
        created_by: string;
      }>(
        `SELECT id AS invoice_id, account_id, client_id, job_id, created_by
         FROM invoices
         WHERE account_id = $1 AND square_order_id = $2`,
        [accountId, refund.order_id ?? ""]
      );
      target = inv.rows[0];
    }

    if (!target) {
      await client.query("COMMIT");
      logger.error("Square webhook: no invoice for refund", {
        refundId: refund.id,
        paymentId: refund.payment_id,
      });
      return;
    }

    const amountCents = refund.amount_money?.amount ?? 0;
    const ins = await client.query<{ id: string }>(
      `INSERT INTO payments
         (account_id, invoice_id, job_id, customer_id, amount_cents, method,
          payment_type, status, external_provider, external_payment_id, created_by)
       VALUES ($1, $2, $3, $4, $5, 'square', 'refund', 'refunded', 'square', $6, $7)
       ON CONFLICT (external_provider, external_payment_id)
         WHERE external_provider IS NOT NULL AND external_payment_id IS NOT NULL
         DO NOTHING
       RETURNING id`,
      [
        target.account_id,
        target.invoice_id,
        target.job_id,
        target.client_id,
        amountCents,
        refund.id,
        target.created_by,
      ]
    );
    if (ins.rowCount === 0) {
      await client.query("COMMIT");
      return;
    }

    await client.query(
      `INSERT INTO workflow_events (account_id, event_type, entity_type, entity_id, payload)
       VALUES ($1, 'payment.recorded', 'payment', $2, $3)`,
      [
        target.account_id,
        ins.rows[0].id,
        JSON.stringify({
          invoiceId: target.invoice_id,
          amountCents,
          method: "square",
          paymentType: "refund",
          source: "square_webhook",
        }),
      ]
    );

    await client.query("COMMIT");
    logger.info("Square refund recorded", { invoiceId: target.invoice_id, amountCents });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
