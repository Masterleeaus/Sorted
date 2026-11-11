-- =============================================================================
-- 208_notification_queue_account_idempotency.sql
--
-- Scopes notification idempotency keys to an account. The worker's enqueue
-- path now looks up and upserts by (account_id, idempotency_key).
--
-- Additive only. The global UNIQUE (idempotency_key) from 060_notification_queue
-- is kept. A later migration drops it once every writer uses the account-scoped
-- target. Until then, a key already used by another account is rejected by the
-- old constraint instead of matching or overwriting that account's row.
--
-- Rollback: DROP INDEX IF EXISTS notification_queue_account_idempotency_key_uniq;
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS notification_queue_account_idempotency_key_uniq
  ON notification_queue (account_id, idempotency_key);
