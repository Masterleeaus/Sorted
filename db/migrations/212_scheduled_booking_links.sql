-- =============================================================================
-- 212_scheduled_booking_links.sql
--
-- Storage for inbound Scheduled booking events (apps/web/lib/scheduled-bookings).
--
--   scheduled_booking_receipts  one row per processed event key (idempotency gate)
--   scheduled_booking_links     Scheduled bookingId -> Sorted job, with the last schedule snapshot
--   scheduled_customer_links    opaque Scheduled customerRef -> Sorted client (mapped by an operator)
--
-- Additive only. Nothing existing is altered. Tenant key is company_id, equal to
-- account_id during the dual-column period (migration 205). Policies follow the
-- account context set by withTokenAccountContext.
--
-- Rollback:
--   DROP TABLE IF EXISTS scheduled_booking_links;
--   DROP TABLE IF EXISTS scheduled_booking_receipts;
--   DROP TABLE IF EXISTS scheduled_customer_links;
-- =============================================================================

CREATE TABLE IF NOT EXISTS scheduled_booking_receipts (
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  event_type      TEXT NOT NULL CHECK (event_type IN ('booking.created', 'booking.cancelled', 'booking.rescheduled')),
  booking_id      TEXT NOT NULL CHECK (char_length(booking_id) BETWEEN 1 AND 128),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS scheduled_booking_links (
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  booking_id        TEXT NOT NULL CHECK (char_length(booking_id) BETWEEN 1 AND 128),
  job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status            TEXT NOT NULL CHECK (status IN ('scheduled', 'rescheduled', 'cancelled')),
  service_id        TEXT NOT NULL,
  staff_ids         JSONB NOT NULL DEFAULT '[]'::jsonb,
  start_at          TIMESTAMPTZ NOT NULL,
  end_at            TIMESTAMPTZ NOT NULL,
  timezone          TEXT NOT NULL,
  last_occurred_at  TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, booking_id),
  CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS scheduled_booking_links_job_idx
  ON scheduled_booking_links (company_id, job_id);

CREATE TABLE IF NOT EXISTS scheduled_customer_links (
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_ref  TEXT NOT NULL CHECK (char_length(customer_ref) BETWEEN 1 AND 128),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, customer_ref)
);

ALTER TABLE scheduled_booking_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_booking_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_customer_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduled_booking_receipts_tenant ON scheduled_booking_receipts;
CREATE POLICY scheduled_booking_receipts_tenant ON scheduled_booking_receipts
  FOR ALL
  USING (company_id = app_account_id())
  WITH CHECK (company_id = app_account_id());

DROP POLICY IF EXISTS scheduled_booking_links_tenant ON scheduled_booking_links;
CREATE POLICY scheduled_booking_links_tenant ON scheduled_booking_links
  FOR ALL
  USING (company_id = app_account_id())
  WITH CHECK (company_id = app_account_id());

DROP POLICY IF EXISTS scheduled_customer_links_tenant ON scheduled_customer_links;
CREATE POLICY scheduled_customer_links_tenant ON scheduled_customer_links
  FOR ALL
  USING (company_id = app_account_id())
  WITH CHECK (company_id = app_account_id());
