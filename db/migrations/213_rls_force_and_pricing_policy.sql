-- =============================================================================
-- 213_rls_force_and_pricing_policy.sql — RLS hardening (issue #6)
--
-- Found by auditing a migrated database (PostgreSQL 16) against the
-- restricted web role ai_fsm_web:
--
-- 1. Nineteen account-scoped tables have ROW LEVEL SECURITY enabled but not
--    FORCE. The restricted role is not the table owner, so enforcement already
--    applies to it. FORCE also applies RLS to the table owner. The owner is the
--    admin role, which is a superuser and bypasses RLS anyway, so this changes no
--    current runtime behaviour. It removes a gap if the owner ever runs queries
--    as a non-superuser.
--
-- 2. pricing_rule_snapshots (migration 046) keys its policy on
--    current_setting('app.account_id'). Nothing sets that name. The app sets
--    app.current_account_id. Under ai_fsm_web the table returns no rows and
--    rejects writes, so it fails closed, but it cannot work. No code reads or
--    writes the table today. The policy is replaced with app_account_id(), the
--    helper every other account policy uses.
--
-- Effects on each role:
--   ai_fsm (superuser, migrations/admin): bypasses RLS, unchanged.
--   ai_fsm_worker (BYPASSRLS): unchanged.
--   ai_fsm_web (NOBYPASSRLS, not owner): unchanged for the 19 tables. The
--     pricing table now works when account context is set and still returns
--     nothing without it.
--   ai_fsm_token_definer (BYPASSRLS, owns the token resolvers): unchanged.
--
-- Additive in effect and reversible. Rollback block at the bottom.
-- =============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'asset_links',
    'automation_settings',
    'communications_log',
    'completion_packets',
    'document_links',
    'notification_cooldowns',
    'notification_queue',
    'period_closes',
    'pricing_rule_snapshots',
    'property_condition_snapshots',
    'property_issues',
    'property_notes',
    'property_vault_item_media',
    'property_vault_items',
    'status_history',
    'visit_checklist_items',
    'visit_media',
    'visit_parts',
    'workflow_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Migration 209 can already have renamed account_id to company_id.
-- Choose the physically present tenant column, never assume the old name.
-- This preserves the previously applied migration's intent on both schema
-- generations, without changing the app_account_id() tenant guard.
DO $pricing_policy$
DECLARE
  tenant_column text;
BEGIN
  SELECT c.column_name INTO tenant_column
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'pricing_rule_snapshots'
    AND c.column_name IN ('company_id', 'account_id')
  ORDER BY CASE WHEN c.column_name = 'company_id' THEN 0 ELSE 1 END
  LIMIT 1;

  IF tenant_column IS NULL THEN
    RAISE EXCEPTION 'pricing_rule_snapshots has no tenant column';
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS pricing_rule_snapshots_account ON public.pricing_rule_snapshots';
  EXECUTE format(
    'CREATE POLICY pricing_rule_snapshots_account ON public.pricing_rule_snapshots USING (%I = app_account_id()) WITH CHECK (%I = app_account_id())',
    tenant_column, tenant_column
  );
END
$pricing_policy$;

-- ROLLBACK (manual, if needed):
--   ALTER TABLE <each table above> NO FORCE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS pricing_rule_snapshots_account ON pricing_rule_snapshots;
--   Recreate the previous policy using the tenant column actually present
--   in the deployment (company_id after 209, account_id before 209).
