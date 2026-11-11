-- Enforce intake media's tenant boundary at the relational layer.
-- A row must never point to an invitation or booking request in another account,
-- even if a privileged writer bypasses application-level tenant checks.
-- These constraints are additive; validate existing records before adoption.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM intake_media AS media
    JOIN intake_invites AS invite ON invite.id = media.intake_invite_id
    WHERE media.account_id <> invite.account_id
  ) OR EXISTS (
    SELECT 1 FROM intake_media AS media
    JOIN booking_requests AS request ON request.id = media.booking_request_id
    WHERE media.account_id <> request.account_id
  ) THEN
    RAISE EXCEPTION 'intake media cross-account links must be remediated before migration 209';
  END IF;
END $$;

-- Composite keys make both linked identities and tenant id jointly referential.
-- Preserve the existing single-column primary keys and their dependent objects.
CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_invites_id_account
  ON intake_invites (id, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_requests_id_account_intake
  ON booking_requests (id, account_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_intake_media_invite_account'
      AND conrelid = 'intake_media'::regclass
  ) THEN
    ALTER TABLE intake_media
      ADD CONSTRAINT fk_intake_media_invite_account
      FOREIGN KEY (intake_invite_id, account_id)
      REFERENCES intake_invites(id, account_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_intake_media_booking_account'
      AND conrelid = 'intake_media'::regclass
  ) THEN
    ALTER TABLE intake_media
      ADD CONSTRAINT fk_intake_media_booking_account
      FOREIGN KEY (booking_request_id, account_id)
      REFERENCES booking_requests(id, account_id) ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON CONSTRAINT fk_intake_media_invite_account ON intake_media IS
  'Media account_id must match the owning intake invite account.';
COMMENT ON CONSTRAINT fk_intake_media_booking_account ON intake_media IS
  'Media account_id must match the linked booking request account.';
