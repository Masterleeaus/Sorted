-- =============================================================================
-- 210_rls_force_and_pricing_policy.sql — RLS hardening (issue #6)
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

DROP POLICY IF EXISTS pricing_rule_snapshots_account ON pricing_rule_snapshots;
CREATE POLICY pricing_rule_snapshots_account
  ON pricing_rule_snapshots
  USING (account_id = app_account_id())
  WITH CHECK (account_id = app_account_id());

-- ROLLBACK (manual, if needed):
--   ALTER TABLE <each table above> NO FORCE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS pricing_rule_snapshots_account ON pricing_rule_snapshots;
--   CREATE POLICY pricing_rule_snapshots_account ON pricing_rule_snapshots
--     USING (account_id = current_setting('app.account_id', true)::uuid);
