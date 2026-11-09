-- =============================================================================
-- 204_token_resolvers.sql — bounded pre-account lookups (TASK-146, issue #6)
--
-- The web runtime role (ai_fsm_web) is NOBYPASSRLS. Some routes must resolve a
-- token, invite, location or candidate to an account BEFORE any account context
-- exists. Those routes cannot read the RLS-protected tables directly under the
-- restricted role. Each function below answers one question and returns the
-- minimum columns needed. The caller then sets app.current_account_id and runs
-- the rest of the request under RLS.
--
-- Ownership: the functions are owned by the migration (admin) role, like
-- app_login_candidates (178) and portal_job_report_account (198). The tables
-- use FORCE ROW LEVEL SECURITY, so the owner needs BYPASSRLS for the lookup to
-- see any row. The boundary is the EXECUTE grant (web role only), the fixed SQL
-- body, and the search_path pin. The web role cannot read the tables directly.
--
-- Every function: SECURITY DEFINER, SET search_path, REVOKE from PUBLIC.
-- scripts/db-provision-runtime.sh grants EXECUTE to ai_fsm_web only.
--
-- Additive and reversible. Rollback: DROP the functions listed in the block at
-- the bottom of this file.
-- =============================================================================

-- Portal client by portal token (portal client, guard and profile routes).
CREATE OR REPLACE FUNCTION resolve_portal_client_account(p_portal_token uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT c.account_id FROM public.clients c
  WHERE c.portal_token = p_portal_token
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_portal_client_account(uuid) FROM PUBLIC;

-- Public estimate by share token (portal estimate route).
CREATE OR REPLACE FUNCTION resolve_estimate_share_account(p_share_token uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT e.account_id FROM public.estimates e
  WHERE e.share_token = p_share_token
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_estimate_share_account(uuid) FROM PUBLIC;

-- Public invoice by share token (portal invoice route).
CREATE OR REPLACE FUNCTION resolve_invoice_share_account(p_share_token uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT i.account_id FROM public.invoices i
  WHERE i.share_token = p_share_token
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_invoice_share_account(uuid) FROM PUBLIC;

-- Open (unused, unexpired) intake invite. Same filter as the intake submit route.
CREATE OR REPLACE FUNCTION resolve_open_intake_invite(p_token uuid)
RETURNS TABLE (
  id uuid, account_id uuid, booking_request_id uuid, lead_name text, lead_email text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT i.id, i.account_id, i.booking_request_id, i.lead_name, i.lead_email
  FROM public.intake_invites i
  WHERE i.token = p_token AND i.used_at IS NULL AND i.expires_at > now()
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_open_intake_invite(uuid) FROM PUBLIC;

-- Whether an intake invite exists and was already used. Used only to choose the
-- 409 / 410 / 404 response after a failed open lookup. Returns no row if the
-- token is unknown.
CREATE OR REPLACE FUNCTION resolve_intake_invite_state(p_token uuid)
RETURNS TABLE (is_used boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT i.used_at IS NOT NULL
  FROM public.intake_invites i
  WHERE i.token = p_token
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_intake_invite_state(uuid) FROM PUBLIC;

-- Square settings for an inbound webhook location id. Signing key stays in the
-- encrypted secrets blob; the caller decrypts it after verification.
CREATE OR REPLACE FUNCTION resolve_square_location_settings(p_location_id text)
RETURNS TABLE (
  account_id uuid, enabled boolean, secrets bytea, webhook_url text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.account_id, s.enabled, s.secrets, s.config->>'webhookUrl'
  FROM public.integration_settings s
  WHERE s.provider = 'square' AND s.config->>'locationId' = p_location_id;
$$;
REVOKE ALL ON FUNCTION resolve_square_location_settings(text) FROM PUBLIC;

-- First owner's account (single-tenant deploy). Same ordering as the prompt
-- routes used before this migration.
CREATE OR REPLACE FUNCTION resolve_owner_account_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.account_id
  FROM public.accounts a
  JOIN public.users u ON u.account_id = a.id
  WHERE u.role = 'owner'
  ORDER BY u.created_at, u.id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_owner_account_id() FROM PUBLIC;

-- Account that owns a visit candidate (arrival prompt ack).
CREATE OR REPLACE FUNCTION resolve_visit_candidate_account(p_candidate_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT vc.account_id FROM public.visit_candidates vc
  WHERE vc.id = p_candidate_id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_visit_candidate_account(uuid) FROM PUBLIC;

-- Portal sign-in link: consume a sign-in magic link (no pending email) and return
-- the client it belongs to. Single statement, so the claim is atomic.
CREATE OR REPLACE FUNCTION consume_portal_magic_link(p_token uuid)
RETURNS TABLE (client_id uuid, portal_token uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.portal_magic_links ml
  SET used_at = now()
  FROM public.clients c
  WHERE ml.token = p_token
    AND ml.used_at IS NULL
    AND ml.expires_at > now()
    AND ml.pending_email IS NULL
    AND c.id = ml.client_id
  RETURNING ml.client_id, c.portal_token;
$$;
REVOKE ALL ON FUNCTION consume_portal_magic_link(uuid) FROM PUBLIC;

-- Portal email change: consume a pending-email link and return the change. The
-- caller runs in one transaction and rolls back if the new address is taken.
CREATE OR REPLACE FUNCTION consume_portal_email_change(p_token uuid)
RETURNS TABLE (
  client_id uuid, email text, old_email text, portal_token uuid, account_id uuid
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.portal_magic_links ml
  SET used_at = now()
  FROM public.clients c
  WHERE ml.token = p_token
    AND ml.pending_email IS NOT NULL
    AND ml.used_at IS NULL
    AND ml.expires_at > now()
    AND c.id = ml.client_id
  RETURNING ml.client_id, ml.pending_email, c.email, c.portal_token, c.account_id;
$$;
REVOKE ALL ON FUNCTION consume_portal_email_change(uuid) FROM PUBLIC;

-- Rollback (run as the admin role, in this order is not required):
--   DROP FUNCTION IF EXISTS resolve_portal_client_account(uuid);
--   DROP FUNCTION IF EXISTS resolve_estimate_share_account(uuid);
--   DROP FUNCTION IF EXISTS resolve_invoice_share_account(uuid);
--   DROP FUNCTION IF EXISTS resolve_open_intake_invite(uuid);
--   DROP FUNCTION IF EXISTS resolve_intake_invite_state(uuid);
--   DROP FUNCTION IF EXISTS resolve_square_location_settings(text);
--   DROP FUNCTION IF EXISTS resolve_owner_account_id();
--   DROP FUNCTION IF EXISTS resolve_visit_candidate_account(uuid);
--   DROP FUNCTION IF EXISTS consume_portal_magic_link(uuid);
--   DROP FUNCTION IF EXISTS consume_portal_email_change(uuid);
-- Then restore the previous unscoped queries in the routes that call them.
