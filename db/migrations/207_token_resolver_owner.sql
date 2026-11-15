-- =============================================================================
-- 207_token_resolver_owner.sql — dedicated owner for the migration 204 resolvers
--
-- Migration 204 left the ten token resolvers owned by the migration (admin) role.
-- This migration moves them to ai_fsm_token_definer: a NOLOGIN role that owns
-- only these functions and holds only the column privileges their bodies use.
-- It does not edit 204. The function bodies, search_path pin, SECURITY DEFINER
-- and REVOKE FROM PUBLIC are unchanged. Only the owner changes.
--
-- Why BYPASSRLS: the protected tables use FORCE ROW LEVEL SECURITY. Without
-- BYPASSRLS the owner would be subject to RLS, and a pre-account lookup (no
-- app.current_account_id yet) would return no rows. BYPASSRLS is granted to this
-- role only. The role can only be used as the owner of the ten functions below:
-- it has no login, no role membership (NOINHERIT, nobody granted to it), it
-- owns no tables or schemas, and its table grants are the exact column list the
-- bodies read or write. Nothing else in the schema is granted to it.
--
-- Creating a BYPASSRLS role needs superuser, so this migration must run as the
-- admin (superuser) role, the same role that applies the other migrations.
--
-- EXECUTE stays with ai_fsm_web, granted by scripts/db-provision-runtime.sh
-- (unchanged). REVOKE ALL FROM PUBLIC from 204 is unchanged.
--
-- Additive and reversible. See the rollback block at the bottom.
-- =============================================================================

-- Idempotent: the role is created only when missing. Existing attributes are not
-- altered here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_fsm_token_definer') THEN
    CREATE ROLE ai_fsm_token_definer NOLOGIN NOSUPERUSER BYPASSRLS NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO ai_fsm_token_definer;

-- Column-level SELECT and UPDATE, derived from each function body in 204.
-- resolve_portal_client_account: clients.account_id, portal_token.
GRANT SELECT (id, account_id, portal_token, email) ON TABLE public.clients TO ai_fsm_token_definer;
-- resolve_estimate_share_account.
GRANT SELECT (account_id, share_token) ON TABLE public.estimates TO ai_fsm_token_definer;
-- resolve_invoice_share_account.
GRANT SELECT (account_id, share_token) ON TABLE public.invoices TO ai_fsm_token_definer;
-- resolve_open_intake_invite and resolve_intake_invite_state.
GRANT SELECT (id, account_id, booking_request_id, lead_name, lead_email, token, used_at, expires_at)
  ON TABLE public.intake_invites TO ai_fsm_token_definer;
-- resolve_square_location_settings.
GRANT SELECT (account_id, provider, config, enabled, secrets)
  ON TABLE public.integration_settings TO ai_fsm_token_definer;
-- resolve_owner_account_id: accounts.id joined to users.
GRANT SELECT (id) ON TABLE public.accounts TO ai_fsm_token_definer;
GRANT SELECT (id, account_id, role, created_at) ON TABLE public.users TO ai_fsm_token_definer;
-- resolve_visit_candidate_account.
GRANT SELECT (id, account_id) ON TABLE public.visit_candidates TO ai_fsm_token_definer;
-- consume_portal_magic_link and consume_portal_email_change: read the link, claim it
-- by setting used_at only.
GRANT SELECT (token, client_id, used_at, expires_at, pending_email)
  ON TABLE public.portal_magic_links TO ai_fsm_token_definer;
GRANT UPDATE (used_at) ON TABLE public.portal_magic_links TO ai_fsm_token_definer;

ALTER FUNCTION resolve_portal_client_account(uuid) OWNER TO ai_fsm_token_definer;
ALTER FUNCTION resolve_estimate_share_account(uuid) OWNER TO ai_fsm_token_definer;
ALTER FUNCTION resolve_invoice_share_account(uuid) OWNER TO ai_fsm_token_definer;
ALTER FUNCTION resolve_open_intake_invite(uuid) OWNER TO ai_fsm_token_definer;
ALTER FUNCTION resolve_intake_invite_state(uuid) OWNER TO ai_fsm_token_definer;
ALTER FUNCTION resolve_square_location_settings(text) OWNER TO ai_fsm_token_definer;
ALTER FUNCTION resolve_owner_account_id() OWNER TO ai_fsm_token_definer;
ALTER FUNCTION resolve_visit_candidate_account(uuid) OWNER TO ai_fsm_token_definer;
ALTER FUNCTION consume_portal_magic_link(uuid) OWNER TO ai_fsm_token_definer;
ALTER FUNCTION consume_portal_email_change(uuid) OWNER TO ai_fsm_token_definer;

-- Rollback (run as the admin role). Restores the 204 state: functions owned by the
-- migration role, no grants to ai_fsm_token_definer, role dropped.
--   ALTER FUNCTION resolve_portal_client_account(uuid) OWNER TO <migration role>;
--   ALTER FUNCTION resolve_estimate_share_account(uuid) OWNER TO <migration role>;
--   ALTER FUNCTION resolve_invoice_share_account(uuid) OWNER TO <migration role>;
--   ALTER FUNCTION resolve_open_intake_invite(uuid) OWNER TO <migration role>;
--   ALTER FUNCTION resolve_intake_invite_state(uuid) OWNER TO <migration role>;
--   ALTER FUNCTION resolve_square_location_settings(text) OWNER TO <migration role>;
--   ALTER FUNCTION resolve_owner_account_id() OWNER TO <migration role>;
--   ALTER FUNCTION resolve_visit_candidate_account(uuid) OWNER TO <migration role>;
--   ALTER FUNCTION consume_portal_magic_link(uuid) OWNER TO <migration role>;
--   ALTER FUNCTION consume_portal_email_change(uuid) OWNER TO <migration role>;
--   REVOKE ALL ON public.clients FROM ai_fsm_token_definer;
--   REVOKE ALL ON public.estimates FROM ai_fsm_token_definer;
--   REVOKE ALL ON public.invoices FROM ai_fsm_token_definer;
--   REVOKE ALL ON public.intake_invites FROM ai_fsm_token_definer;
--   REVOKE ALL ON public.integration_settings FROM ai_fsm_token_definer;
--   REVOKE ALL ON public.accounts FROM ai_fsm_token_definer;
--   REVOKE ALL ON public.users FROM ai_fsm_token_definer;
--   REVOKE ALL ON public.visit_candidates FROM ai_fsm_token_definer;
--   REVOKE ALL ON public.portal_magic_links FROM ai_fsm_token_definer;
--   REVOKE USAGE ON SCHEMA public FROM ai_fsm_token_definer;
--   -- Drop only when nothing else depends on the role. DROP ROLE fails otherwise,
--   -- which is the intended guard.
--   DROP ROLE IF EXISTS ai_fsm_token_definer;
