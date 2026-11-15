-- Migration 203: intake_media — customer photos attached to a public intake request.
--
-- Rows are created by POST /api/intake/[token]/media after the invite token is
-- validated. The account and invite come from the invite row, never from the
-- client. booking_request_id is filled in at submit time, when the invite is
-- linked to a booking request.
--
-- Files live under UPLOAD_ROOT/intake/<intake_invite_id>/<uuid>.<ext>. The
-- filename is server-generated. No public route serves these files.
--
-- Additive and reversible. Rollback: DROP TABLE intake_media;

CREATE TABLE IF NOT EXISTS intake_media (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  intake_invite_id    uuid        NOT NULL REFERENCES intake_invites(id) ON DELETE CASCADE,
  booking_request_id  uuid        REFERENCES booking_requests(id) ON DELETE CASCADE,
  filename            text        NOT NULL,
  original_name       text        NOT NULL,
  mime_type           text        NOT NULL CHECK (mime_type IN (
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'
  )),
  size_bytes          integer     NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_media_invite
  ON intake_media (intake_invite_id);

CREATE INDEX IF NOT EXISTS idx_intake_media_booking
  ON intake_media (booking_request_id)
  WHERE booking_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_intake_media_account
  ON intake_media (account_id);

ALTER TABLE intake_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_media FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'intake_media' AND policyname = 'intake_media_select'
  ) THEN
    CREATE POLICY intake_media_select ON intake_media
      FOR SELECT USING (account_id = app_account_id());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'intake_media' AND policyname = 'intake_media_insert'
  ) THEN
    CREATE POLICY intake_media_insert ON intake_media
      FOR INSERT WITH CHECK (account_id = app_account_id());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'intake_media' AND policyname = 'intake_media_update'
  ) THEN
    CREATE POLICY intake_media_update ON intake_media
      FOR UPDATE USING (account_id = app_account_id());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'intake_media' AND policyname = 'intake_media_delete'
  ) THEN
    CREATE POLICY intake_media_delete ON intake_media
      FOR DELETE USING (account_id = app_account_id());
  END IF;
END $$;

COMMENT ON TABLE intake_media IS 'Customer photos attached to a public intake request. Files are not served publicly. See docs/working/intake-photo-attachments.md.';
