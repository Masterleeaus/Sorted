-- =============================================================================
-- 210_organisation_memberships.sql — durable Central membership mapping (issue #40)
--
-- Central owns identity, organisation and membership. This table is Sorted's
-- durable record of which local account and user a Central identity acts as
-- inside one Titan organisation. The organisation is the verified
-- `titan_organisation_id` claim, never request input.
--
-- One identity may hold several memberships (one per organisation). Each
-- membership maps to exactly one Sorted account, which is the tenant key the
-- session is scoped to. State and revision are copied from Central's record,
-- so a revoked or suspended membership, or a changed one, fails the session
-- check in lib/auth/session.ts.
--
-- Additive. Nothing existing is altered. Rollback (run by hand, in this order):
--   DROP FUNCTION IF EXISTS resolve_organisation_membership(TEXT, TEXT);
--   DROP TABLE IF EXISTS organisation_memberships;
-- =============================================================================

CREATE TABLE IF NOT EXISTS organisation_memberships (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  central_subject       TEXT NOT NULL
    CHECK (central_subject ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  titan_organisation_id TEXT NOT NULL
    CHECK (titan_organisation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  role                  TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'tech')),
  state                 TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'suspended', 'revoked')),
  revision              INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One membership per identity and organisation: an identity cannot act for
  -- the same organisation through two accounts.
  CONSTRAINT organisation_memberships_subject_org_unique UNIQUE (central_subject, titan_organisation_id),
  CONSTRAINT organisation_memberships_account_user_org_unique UNIQUE (account_id, user_id, titan_organisation_id)
);

CREATE INDEX IF NOT EXISTS idx_organisation_memberships_account
  ON organisation_memberships (account_id);

-- Row-level scoping: a session sees only memberships of its own account.
-- Writes are limited to owners and admins of that account. The table is not
-- FORCE'd, so the SECURITY DEFINER resolver below (owned by the migration role)
-- can look up a membership before any account context exists.
ALTER TABLE organisation_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organisation_memberships_select ON organisation_memberships;
CREATE POLICY organisation_memberships_select ON organisation_memberships
  FOR SELECT USING (account_id = app_account_id());

DROP POLICY IF EXISTS organisation_memberships_insert ON organisation_memberships;
CREATE POLICY organisation_memberships_insert ON organisation_memberships
  FOR INSERT WITH CHECK (account_id = app_account_id() AND is_owner_or_admin());

DROP POLICY IF EXISTS organisation_memberships_update ON organisation_memberships;
CREATE POLICY organisation_memberships_update ON organisation_memberships
  FOR UPDATE USING (account_id = app_account_id() AND is_owner_or_admin());

DROP POLICY IF EXISTS organisation_memberships_delete ON organisation_memberships;
CREATE POLICY organisation_memberships_delete ON organisation_memberships
  FOR DELETE USING (account_id = app_account_id() AND is_owner_or_admin());

-- Login-time lookup: maps a verified (Central subject, organisation) pair to
-- its single membership. Returns no rows for any other pair, so a user cannot
-- reach another organisation by choosing it.
CREATE OR REPLACE FUNCTION resolve_organisation_membership(p_subject TEXT, p_organisation_id TEXT)
RETURNS TABLE (account_id UUID, user_id UUID, role TEXT, state TEXT, revision INTEGER)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT m.account_id, m.user_id, m.role, m.state, m.revision
    FROM organisation_memberships m
   WHERE m.central_subject = p_subject
     AND m.titan_organisation_id = p_organisation_id;
$$;
