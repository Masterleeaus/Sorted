-- Issue #23: match Square webhook payments to their exact pending link.
--
-- Each Square payment link creates its own order. Storing that order id (and
-- the payment link id) on the pending payment row lets the webhook match a
-- completed payment to the row for that link, not to the oldest pending row
-- on the invoice.
--
-- Additive only: two nullable columns and one partial unique index. Existing
-- pending rows keep NULL here; the webhook handles them with a narrow fallback
-- (see apps/web/app/api/webhooks/square/route.ts).
--
-- Rollback:
-- DROP INDEX IF EXISTS payments_square_order_key;
-- ALTER TABLE payments DROP COLUMN IF EXISTS external_order_id,
--                      DROP COLUMN IF EXISTS external_link_id;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS external_order_id text,
  ADD COLUMN IF NOT EXISTS external_link_id  text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_square_order_key
  ON payments (external_provider, external_order_id)
  WHERE external_provider IS NOT NULL AND external_order_id IS NOT NULL;
