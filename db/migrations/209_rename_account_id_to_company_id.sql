-- =============================================================================
-- 209_rename_account_id_to_company_id.sql — tenant key rename (issue #26, #40)
--
-- Renames the Sorted tenant column account_id to company_id on every tenant
-- table. This is a rename, not a backfill: no tenant value is copied or
-- recomputed. It is a forward migration; no earlier migration is edited.
--
-- Starting state (after 205_company_foundation.sql): all 74 tenant tables carry
-- BOTH account_id and a mirror company_id, kept equal by the trigger
-- trg_company_tenant_sync and backfilled by 205. companies has one row per
-- accounts row with the same id. A plain RENAME COLUMN would collide with the
-- mirror, so this migration first removes the mirror after proving it equal.
--
-- Steps, all in one transaction:
--   1. Prove company_id = account_id on every tenant row (fail loud otherwise).
--   2. Drop the 205 sync trigger on each tenant table and its function.
--   3. Drop the 205 mirror company_id columns. Their indexes and NOT VALID foreign
--      keys go with them.
--   4. Drop the two views that read account_id (property_timeline_v,
--      vehicle_cost_summary). Step 6 recreates them.
--   5. RENAME COLUMN account_id TO company_id on each tenant table. PostgreSQL
--      updates indexes, constraints (foreign keys, uniques, checks) and RLS
--      policy expressions that reference the column, because they bind by column
--      number, not by name.
--   6. Recreate the plpgsql functions and views whose bodies name the column.
--      Four functions also return account_id in RETURNS TABLE, so they are
--      dropped and recreated with the same grants.
--   7. Rename index, constraint and policy names that carry the account token.
--   8. Verify that no tenant table, policy, view or function still names
--      account_id.
--
-- Deliberately NOT changed here:
--   * The session setting app.current_account_id (and app.company_id, set by
--     withDbSession). Policies and app_account_id() read the setting, so it keeps
--     its name.
--   * Function names that contain account (for example resolve_owner_account_id,
--     portal_job_report_account). Callers invoke them by name.
--   * The accounts and companies tables, and the foreign keys from tenant tables
--     to accounts(id). companies stays 1:1 with accounts. Re-pointing the foreign
--     keys to companies(id) is a later step.
--   * Policy expressions. Their logic is unchanged; only the column name changed.
--
-- Rollback: not provided as SQL. Restoring the old column name requires the
-- reverse rename of the same objects. Take a database backup before applying.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Precondition: the mirror must equal the tenant key on every row
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r record;
  v_mismatch bigint;
BEGIN
  FOR r IN
    SELECT c.table_name::text AS table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name = 'account_id'
    ORDER BY c.table_name
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.table_name AND column_name = 'company_id'
    ) THEN
      RAISE EXCEPTION 'table % has account_id but no company_id mirror; run 205 first', r.table_name;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE company_id IS DISTINCT FROM account_id',
      r.table_name) INTO v_mismatch;

    IF v_mismatch > 0 THEN
      RAISE EXCEPTION 'table % has % rows where company_id differs from account_id; refusing to rename',
        r.table_name, v_mismatch;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Remove the 205 sync trigger and its function
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tgrelid::regclass::text AS tbl
    FROM pg_trigger
    WHERE tgname = 'trg_company_tenant_sync' AND NOT tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_company_tenant_sync ON %s', r.tbl);
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.sync_company_tenant_columns();

-- ---------------------------------------------------------------------------
-- 3. Drop the 205 mirror columns (their indexes and foreign keys drop with them)
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name::text AS table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name = 'account_id'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN company_id', r.table_name);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Drop the views that read account_id (recreated in step 6)
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS public.property_timeline_v;
DROP VIEW IF EXISTS public.vehicle_cost_summary;

-- ---------------------------------------------------------------------------
-- 5. Rename the tenant column on every tenant table
-- ---------------------------------------------------------------------------

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name::text AS table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name = 'account_id'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('ALTER TABLE public.%I RENAME COLUMN account_id TO company_id', r.table_name);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Recreate the functions and views that name the column
--    (generated from the catalog; account_id replaced by company_id, and the
--    app.current_account_id setting left as it is)
-- ---------------------------------------------------------------------------

-- app_login_candidates
DROP FUNCTION IF EXISTS public.app_login_candidates(text);
CREATE FUNCTION public.app_login_candidates(login_email text)
 RETURNS TABLE(id uuid, email text, full_name text, role text, company_id uuid, password_hash text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT u.id, u.email, u.full_name, u.role, u.company_id, u.password_hash
  FROM public.users u
  WHERE lower(u.email) = lower(login_email)
  ORDER BY u.created_at ASC, u.id ASC
  LIMIT 2;
$function$;
REVOKE EXECUTE ON FUNCTION public.app_login_candidates(text) FROM PUBLIC;

-- assign_estimate_number
CREATE OR REPLACE FUNCTION public.assign_estimate_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE yr TEXT; seq INT;
BEGIN
  IF NEW.estimate_number IS NULL THEN
    yr := to_char(COALESCE(NEW.created_at, now()), 'YYYY');
    SELECT COALESCE(MAX(split_part(estimate_number, '-', 3)::int), 0) + 1 INTO seq
      FROM estimates
      WHERE company_id = NEW.company_id AND estimate_number LIKE 'EST-' || yr || '-%';
    NEW.estimate_number := 'EST-' || yr || '-' || lpad(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END; $function$;

-- assign_job_number
CREATE OR REPLACE FUNCTION public.assign_job_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE yr TEXT; seq INT;
BEGIN
  IF NEW.job_number IS NULL THEN
    yr := to_char(COALESCE(NEW.created_at, now()), 'YYYY');
    SELECT COALESCE(MAX(split_part(job_number, '-', 3)::int), 0) + 1 INTO seq
      FROM jobs
      WHERE company_id = NEW.company_id AND job_number LIKE 'J-' || yr || '-%';
    NEW.job_number := 'J-' || yr || '-' || lpad(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END; $function$;

-- complete_job_from_closeout
CREATE OR REPLACE FUNCTION public.complete_job_from_closeout(p_job_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  new_status text;
BEGIN
  IF current_setting('app.current_account_id', true) IS NULL
     OR current_setting('app.current_account_id', true) = '' THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE jobs
     SET status = 'completed', updated_at = now()
   WHERE id = p_job_id
     AND company_id = current_setting('app.current_account_id')::uuid
     AND status = 'in_progress'
  RETURNING status INTO new_status;

  RETURN new_status;
END;
$function$;

-- consume_portal_email_change
DROP FUNCTION IF EXISTS public.consume_portal_email_change(uuid);
CREATE FUNCTION public.consume_portal_email_change(p_token uuid)
 RETURNS TABLE(client_id uuid, email text, old_email text, portal_token uuid, company_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  UPDATE public.portal_magic_links ml
  SET used_at = now()
  FROM public.clients c
  WHERE ml.token = p_token
    AND ml.pending_email IS NOT NULL
    AND ml.used_at IS NULL
    AND ml.expires_at > now()
    AND c.id = ml.client_id
  RETURNING ml.client_id, ml.pending_email, c.email, c.portal_token, c.company_id;
$function$;
REVOKE EXECUTE ON FUNCTION public.consume_portal_email_change(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_portal_email_change(uuid) TO ai_fsm_token_definer;

-- portal_job_report_account
CREATE OR REPLACE FUNCTION public.portal_job_report_account(report_token uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT r.company_id FROM public.portal_job_updates r
  WHERE r.share_token = report_token AND r.status = 'published';
$function$;

-- protect_primary_property_relationship
CREATE OR REPLACE FUNCTION public.protect_primary_property_relationship()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM clients c
    WHERE c.primary_property_id = OLD.id
      AND (
        NEW.company_id IS DISTINCT FROM c.company_id
        OR NEW.client_id IS DISTINCT FROM c.id
      )
  ) THEN
    RAISE EXCEPTION 'property is selected as a client''s main property'
      USING errcode = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

-- resolve_estimate_share_account
CREATE OR REPLACE FUNCTION public.resolve_estimate_share_account(p_share_token uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT e.company_id FROM public.estimates e
  WHERE e.share_token = p_share_token
  LIMIT 1;
$function$;

-- resolve_invoice_share_account
CREATE OR REPLACE FUNCTION public.resolve_invoice_share_account(p_share_token uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT i.company_id FROM public.invoices i
  WHERE i.share_token = p_share_token
  LIMIT 1;
$function$;

-- resolve_open_intake_invite
DROP FUNCTION IF EXISTS public.resolve_open_intake_invite(uuid);
CREATE FUNCTION public.resolve_open_intake_invite(p_token uuid)
 RETURNS TABLE(id uuid, company_id uuid, booking_request_id uuid, lead_name text, lead_email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT i.id, i.company_id, i.booking_request_id, i.lead_name, i.lead_email
  FROM public.intake_invites i
  WHERE i.token = p_token AND i.used_at IS NULL AND i.expires_at > now()
  LIMIT 1;
$function$;
REVOKE EXECUTE ON FUNCTION public.resolve_open_intake_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_open_intake_invite(uuid) TO ai_fsm_token_definer;

-- resolve_owner_account_id
CREATE OR REPLACE FUNCTION public.resolve_owner_account_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT u.company_id
  FROM public.accounts a
  JOIN public.users u ON u.company_id = a.id
  WHERE u.role = 'owner'
  ORDER BY u.created_at, u.id
  LIMIT 1;
$function$;

-- resolve_portal_client_account
CREATE OR REPLACE FUNCTION public.resolve_portal_client_account(p_portal_token uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT c.company_id FROM public.clients c
  WHERE c.portal_token = p_portal_token
  LIMIT 1;
$function$;

-- resolve_square_location_settings
DROP FUNCTION IF EXISTS public.resolve_square_location_settings(text);
CREATE FUNCTION public.resolve_square_location_settings(p_location_id text)
 RETURNS TABLE(company_id uuid, enabled boolean, secrets bytea, webhook_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT s.company_id, s.enabled, s.secrets, s.config->>'webhookUrl'
  FROM public.integration_settings s
  WHERE s.provider = 'square' AND s.config->>'locationId' = p_location_id;
$function$;
REVOKE EXECUTE ON FUNCTION public.resolve_square_location_settings(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_square_location_settings(text) TO ai_fsm_token_definer;

-- resolve_visit_candidate_account
CREATE OR REPLACE FUNCTION public.resolve_visit_candidate_account(p_candidate_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT vc.company_id FROM public.visit_candidates vc
  WHERE vc.id = p_candidate_id
  LIMIT 1;
$function$;

-- validate_client_primary_property
CREATE OR REPLACE FUNCTION public.validate_client_primary_property()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.primary_property_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM properties p
    WHERE p.id = NEW.primary_property_id
      AND p.company_id = NEW.company_id
      AND p.client_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'main property must use this client as primary service contact'
      USING errcode = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

-- validate_property_contact_context
CREATE OR REPLACE FUNCTION public.validate_property_contact_context()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM properties p
    WHERE p.id = NEW.property_id AND p.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'property_contacts must reference a property in the same account'
      USING errcode = '23514';
  END IF;

  IF NEW.client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.id = NEW.client_id AND c.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'registered property contact must reference a client in the same account'
      USING errcode = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

-- validate_sponsored_invoice_context
CREATE OR REPLACE FUNCTION public.validate_sponsored_invoice_context()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM clients c
    WHERE c.id = NEW.client_id AND c.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'invoice payer must belong to invoice account'
      USING errcode = '23514';
  END IF;

  IF NEW.job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.id = NEW.job_id
      AND j.company_id = NEW.company_id
      AND j.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'invoice project must belong to payer and invoice account'
      USING errcode = '23514';
  END IF;

  IF NEW.billing_context = 'standard' THEN
    IF NEW.sponsored_purpose IS NOT NULL
      OR NEW.beneficiary_property_contact_id IS NOT NULL
      OR NEW.business_purpose IS NOT NULL
    THEN
      RAISE EXCEPTION 'standard invoice cannot contain sponsored-work fields'
        USING errcode = '23514';
    END IF;
    IF NEW.property_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM properties p
      WHERE p.id = NEW.property_id
        AND p.company_id = NEW.company_id
        AND p.client_id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'standard invoice property must belong to payer and invoice account'
        USING errcode = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.property_id IS NULL OR NEW.sponsored_purpose IS NULL THEN
    RAISE EXCEPTION 'sponsored invoice requires property and purpose'
      USING errcode = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM properties p
    WHERE p.id = NEW.property_id AND p.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'sponsored property must belong to invoice account'
      USING errcode = '23514';
  END IF;

  IF NEW.beneficiary_property_contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM property_contacts pc
    WHERE pc.id = NEW.beneficiary_property_contact_id
      AND pc.company_id = NEW.company_id
      AND pc.property_id = NEW.property_id
  ) THEN
    RAISE EXCEPTION 'sponsored beneficiary must belong to selected property'
      USING errcode = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

-- view property_timeline_v (recreated: output column is now company_id)
CREATE VIEW public.property_timeline_v AS
SELECT v.company_id,
    j.property_id,
    'visit'::text AS event_type,
    v.id AS entity_id,
    COALESCE(v.completed_at, v.scheduled_start) AS occurred_at,
    COALESCE(j.title, 'Untitled visit'::text) AS summary,
    jsonb_build_object('visit_type', v.visit_type, 'status', v.status, 'tech_notes', v.tech_notes, 'job_id', j.id, 'job_status', j.status, 'plan_id', v.maintenance_plan_id) AS metadata,
    v.id::text AS link_id,
    v.status AS detail,
    NULL::integer AS total_cents
   FROM visits v
     JOIN jobs j ON j.id = v.job_id
  WHERE j.property_id IS NOT NULL
UNION ALL
 SELECT e.company_id,
    e.property_id,
    'estimate'::text AS event_type,
    e.id AS entity_id,
    COALESCE(e.sent_at, e.created_at) AS occurred_at,
    COALESCE(j.title, 'Estimate'::text) AS summary,
    jsonb_build_object('status', e.status, 'total_cents', e.total_cents, 'vault_item_id', e.vault_item_id) AS metadata,
    e.id::text AS link_id,
    e.status AS detail,
    e.total_cents
   FROM estimates e
     LEFT JOIN jobs j ON j.id = e.job_id
  WHERE e.property_id IS NOT NULL AND e.status <> 'draft'::text
UNION ALL
 SELECT i.company_id,
    i.property_id,
    'invoice'::text AS event_type,
    i.id AS entity_id,
    COALESCE(i.sent_at, i.created_at) AS occurred_at,
    'Invoice '::text || i.invoice_number AS summary,
    jsonb_build_object('status', i.status, 'total_cents', i.total_cents, 'paid_cents', i.paid_cents) AS metadata,
    i.id::text AS link_id,
    i.status AS detail,
    i.total_cents
   FROM invoices i
  WHERE i.property_id IS NOT NULL AND i.status <> 'draft'::text
UNION ALL
 SELECT p.company_id,
    i.property_id,
    'payment'::text AS event_type,
    p.id AS entity_id,
    COALESCE(p.paid_at, p.received_at) AS occurred_at,
    'Payment received — '::text || p.method AS summary,
    jsonb_build_object('method', p.method, 'payment_type', p.payment_type, 'status', p.status, 'amount_cents', p.amount_cents, 'invoice_id', p.invoice_id) AS metadata,
    p.invoice_id::text AS link_id,
    p.method AS detail,
    p.amount_cents AS total_cents
   FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
  WHERE i.property_id IS NOT NULL AND p.status = 'paid'::text
UNION ALL
 SELECT w.company_id,
    w.property_id,
    'work_order'::text AS event_type,
    w.id AS entity_id,
    COALESCE(w.completed_at, w.updated_at) AS occurred_at,
    w.title AS summary,
    jsonb_build_object('status', w.status, 'total_cents', w.total_cents, 'job_id', w.job_id, 'source_visit_id', w.source_visit_id, 'materials_count', ( SELECT count(*) AS count
           FROM work_order_materials m
          WHERE m.work_order_id = w.id), 'materials', COALESCE(( SELECT jsonb_agg(jsonb_build_object('description', m.description, 'quantity', m.quantity) ORDER BY m.sort_order) AS jsonb_agg
           FROM work_order_materials m
          WHERE m.work_order_id = w.id), '[]'::jsonb)) AS metadata,
    w.id::text AS link_id,
    COALESCE(( SELECT string_agg(m.description, ', '::text ORDER BY m.sort_order) AS string_agg
           FROM work_order_materials m
          WHERE m.work_order_id = w.id), w.status) AS detail,
    w.total_cents
   FROM work_orders w
  WHERE w.property_id IS NOT NULL AND w.status = 'completed'::text
UNION ALL
 SELECT pvi.company_id,
    pvi.property_id,
    'vault_item'::text AS event_type,
    pvi.id AS entity_id,
    pvi.created_at AS occurred_at,
    pvi.name AS summary,
    jsonb_build_object('category', pvi.category, 'manufacturer', pvi.manufacturer, 'model_number', pvi.model_number, 'install_date', pvi.install_date, 'last_serviced', pvi.last_serviced_date) AS metadata,
    NULL::text AS link_id,
    pvi.category AS detail,
    NULL::integer AS total_cents
   FROM property_vault_items pvi
UNION ALL
 SELECT pvi.company_id,
    pvi.property_id,
    'photo'::text AS event_type,
    pvim.id AS entity_id,
    pvim.created_at AS occurred_at,
    (pvim.photo_role || ' — '::text) || pvi.name AS summary,
    jsonb_build_object('photo_role', pvim.photo_role, 'vault_item_id', pvim.vault_item_id, 'vault_item_name', pvi.name, 'visit_id', pvim.visit_id, 'paired_media_id', pvim.paired_media_id, 'filename', pvim.filename) AS metadata,
    NULL::text AS link_id,
    pvim.photo_role AS detail,
    NULL::integer AS total_cents
   FROM property_vault_item_media pvim
     JOIN property_vault_items pvi ON pvi.id = pvim.vault_item_id
UNION ALL
 SELECT pi.company_id,
    pi.property_id,
    'issue'::text AS event_type,
    pi.id AS entity_id,
    pi.first_noted_at AS occurred_at,
    pi.title AS summary,
    jsonb_build_object('status', pi.status, 'severity', pi.severity, 'area', pi.area, 'occurrences', pi.occurrence_count) AS metadata,
    NULL::text AS link_id,
    pi.status AS detail,
    NULL::integer AS total_cents
   FROM property_issues pi
UNION ALL
 SELECT pn.company_id,
    pn.property_id,
    'note'::text AS event_type,
    pn.id AS entity_id,
    pn.created_at AS occurred_at,
    "left"(pn.body, 120) AS summary,
    jsonb_build_object('source', pn.source, 'pinned', pn.pinned, 'visit_id', pn.visit_id) AS metadata,
    NULL::text AS link_id,
    pn.source AS detail,
    NULL::integer AS total_cents
   FROM property_notes pn
UNION ALL
 SELECT mp.company_id,
    mp.property_id,
    'membership'::text AS event_type,
    mp.id AS entity_id,
    mp.created_at AS occurred_at,
    mp.name AS summary,
    jsonb_build_object('status', mp.status) AS metadata,
    mp.id::text AS link_id,
    mp.status AS detail,
    NULL::integer AS total_cents
   FROM maintenance_plans mp
  WHERE mp.property_id IS NOT NULL;

-- view vehicle_cost_summary (recreated: output column is now company_id)
CREATE VIEW public.vehicle_cost_summary AS
SELECT company_id,
    vehicle_id,
    date_trunc('month'::text, expense_date::timestamp with time zone)::date AS period_month,
    category,
    sum(amount_cents) AS total_cents,
    count(*)::integer AS expense_count
   FROM expenses e
  WHERE vehicle_id IS NOT NULL
  GROUP BY company_id, vehicle_id, (date_trunc('month'::text, expense_date::timestamp with time zone)), category;


-- ---------------------------------------------------------------------------
-- 7. Rename constraint, index and policy names that carry the account token.
--    Objects on account_supplier_preferences are left alone: its own table name
--    contains the word. A name collision fails the migration.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r record;
  v_prefix text;
  v_new text;
BEGIN
  -- A name that begins with its own table name (only account_supplier_preferences
  -- has 'account' in its table name) keeps that prefix; only the rest is renamed.
  -- Constraints first: renaming a unique or primary key also renames its index.
  FOR r IN
    SELECT cl.relname::text AS tbl, c.conname::text AS cname
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public'
      AND cl.relname IN (
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'company_id' AND table_name <> 'companies')
  LOOP
    v_prefix := CASE WHEN r.tbl ~ 'account' AND left(r.cname, length(r.tbl) + 1) = r.tbl || '_'
                     THEN r.tbl || '_' ELSE '' END;
    v_new := v_prefix || regexp_replace(substr(r.cname, length(v_prefix) + 1),
                                        '(^|_)account(_|$)', '\1company\2', 'g');
    IF v_new <> r.cname THEN
      EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I', r.tbl, r.cname, v_new);
    END IF;
  END LOOP;

  -- Indexes that do not back a constraint
  FOR r IN
    SELECT tc.relname::text AS tbl, ic.relname::text AS iname
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class tc ON tc.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tc.relnamespace
    WHERE n.nspname = 'public'
      AND tc.relname IN (
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'company_id' AND table_name <> 'companies')
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
  LOOP
    v_prefix := CASE WHEN r.tbl ~ 'account' AND left(r.iname, length(r.tbl) + 1) = r.tbl || '_'
                     THEN r.tbl || '_' ELSE '' END;
    v_new := v_prefix || regexp_replace(substr(r.iname, length(v_prefix) + 1),
                                        '(^|_)account(_|$)', '\1company\2', 'g');
    IF v_new <> r.iname THEN
      EXECUTE format('ALTER INDEX public.%I RENAME TO %I', r.iname, v_new);
    END IF;
  END LOOP;

  -- RLS policy names
  FOR r IN
    SELECT p.tablename::text AS tbl, p.policyname::text AS pname
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename IN (
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'company_id' AND table_name <> 'companies')
  LOOP
    v_prefix := CASE WHEN r.tbl ~ 'account' AND left(r.pname, length(r.tbl) + 1) = r.tbl || '_'
                     THEN r.tbl || '_' ELSE '' END;
    v_new := v_prefix || regexp_replace(substr(r.pname, length(v_prefix) + 1),
                                        '(^|_)account(_|$)', '\1company\2', 'g');
    IF v_new <> r.pname THEN
      EXECUTE format('ALTER POLICY %I ON public.%I RENAME TO %I', r.pname, r.tbl, v_new);
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Verify: nothing in the schema still names account_id as a column
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name = 'account_id';
  IF v_count > 0 THEN
    RAISE EXCEPTION '% columns named account_id remain after rename', v_count;
  END IF;

  -- app.account_id (a setting, not a column) is excluded from this check; see the PR notes.
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (replace(qual, 'app.account_id', '') ~ '\yaccount_id\y'
         OR replace(with_check, 'app.account_id', '') ~ '\yaccount_id\y');
  IF v_count > 0 THEN
    RAISE EXCEPTION '% policies still reference account_id', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosrc ~ '\yaccount_id\y';
  IF v_count > 0 THEN
    RAISE EXCEPTION '% functions still reference account_id', v_count;
  END IF;
END;
$$;

COMMIT;
