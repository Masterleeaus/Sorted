-- =============================================================================
-- 205_company_foundation.sql — canonical company_id tenant key, dual-column period
-- (issue #26, foundation step)
--
-- Sorted moves its tenant key from account_id to company_id. This migration is
-- the additive first step. Nothing is renamed or dropped:
--
--   * companies: one row per accounts row, with the SAME id. An existing
--     account id is therefore a valid company id, and no existing value changes.
--   * Every table that has an account_id uuid column gets company_id uuid,
--     backfilled as company_id = account_id, with an index and a foreign key
--     added NOT VALID (validated in a later migration).
--   * A BEFORE INSERT OR UPDATE trigger keeps the two columns equal while old
--     and new writers coexist: it fills whichever column is NULL from the other,
--     and rejects a row where both are set and differ.
--   * accounts INSERT/UPDATE keeps companies in step (AFTER trigger). Without
--     it, a new account would have no companies row for the NOT VALID foreign
--     key to point at.
--   * No existing RLS policy is changed. Reads keep using app.current_account_id.
--     app.company_id is set alongside it by withDbSession (apps/web/lib/db.ts).
--
-- Not in this migration (later steps): NOT NULL, FK validation, company-based
-- policies, dropping account_id, and converting query code.
--
-- Runs in one transaction. The backfill uses SET LOCAL session_replication_role
-- = replica so immutability triggers on estimates and invoices (004) do not block
-- setting a key on rows in terminal states. The setting ends with the transaction.
-- It needs superuser, which the migration role already has (ai_fsm).
--
-- Rollback: the block at the bottom of this file, between the ROLLBACK SCRIPT
-- markers. It removes only objects this migration creates. It keeps account_id,
-- accounts, and all other data.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. companies root table (1:1 with accounts, same id)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS companies (
  id         uuid PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Same visibility as accounts: a session sees only its own company row.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_select ON companies;
CREATE POLICY companies_select ON companies
  FOR SELECT
  USING (id = app_account_id());

INSERT INTO companies (id, name, created_at)
SELECT a.id, a.name, a.created_at
FROM accounts a
ON CONFLICT (id) DO NOTHING;

-- Keep companies in step with accounts for new and renamed accounts.
-- SECURITY DEFINER: the writer of an accounts row does not need INSERT rights
-- on companies, which have no write policy for app roles.
CREATE OR REPLACE FUNCTION sync_company_from_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.companies (id, name, created_at)
  VALUES (NEW.id, NEW.name, NEW.created_at)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounts_company_sync ON accounts;
CREATE TRIGGER trg_accounts_company_sync
  AFTER INSERT OR UPDATE OF name ON accounts
  FOR EACH ROW EXECUTE FUNCTION sync_company_from_account();

-- ---------------------------------------------------------------------------
-- 2. Dual-column sync trigger for every tenant table
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_company_tenant_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.account_id IS NOT NULL THEN
    NEW.company_id := NEW.account_id;
  END IF;
  IF NEW.account_id IS NULL AND NEW.company_id IS NOT NULL THEN
    NEW.account_id := NEW.company_id;
  END IF;
  IF NEW.company_id IS DISTINCT FROM NEW.account_id THEN
    RAISE EXCEPTION 'company_id (%) must equal account_id (%) during the dual-column period',
      NEW.company_id, NEW.account_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Add company_id, backfill, index, NOT VALID foreign key, per tenant table
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r record;
  v_base text;
  v_idx text;
  v_fk text;
BEGIN
  -- Fail loud on a non-uuid account_id rather than silently skipping a table.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name = 'account_id'
      AND c.udt_name <> 'uuid'
  ) THEN
    RAISE EXCEPTION 'account_id column is not uuid on at least one table; company foundation cannot backfill it';
  END IF;

  SET LOCAL session_replication_role = replica;

  FOR r IN
    SELECT c.table_name::text AS table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name = 'account_id'
      AND c.table_name NOT IN ('accounts', 'companies')
    ORDER BY c.table_name
  LOOP
    -- Names stay under the 63-byte identifier limit and stay unique per table.
    v_base := CASE WHEN length(r.table_name) <= 44
                   THEN r.table_name
                   ELSE left(r.table_name, 30) || '_' || substr(md5(r.table_name), 1, 10)
              END;
    v_idx := v_base || '_company_id_idx';
    v_fk  := v_base || '_company_id_fkey';

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid', r.table_name);

    EXECUTE format(
      'UPDATE public.%I SET company_id = account_id WHERE company_id IS NULL AND account_id IS NOT NULL',
      r.table_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (company_id)', v_idx, r.table_name);

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', r.table_name)::regclass
        AND conname = v_fk
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES public.companies (id) NOT VALID',
        r.table_name, v_fk);
    END IF;
  END LOOP;

  SET LOCAL session_replication_role = DEFAULT;

  -- Install the sync trigger after the backfill, so the backfill is not affected by it.
  FOR r IN
    SELECT c.table_name::text AS table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name = 'account_id'
      AND c.table_name NOT IN ('accounts', 'companies')
    ORDER BY c.table_name
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_company_tenant_sync ON public.%I', r.table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_company_tenant_sync BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION sync_company_tenant_columns()',
      r.table_name);
  END LOOP;
END;
$$;

COMMIT;

-- =============================================================================
-- ROLLBACK SCRIPT BEGIN
-- Admin role. To roll back, remove the leading "-- " from each line below and
-- run the lines in order. Each step drops only what this migration created.
-- The company_id columns hold copies of account_id, so dropping them loses no
-- tenant data. Account_id and every other column stay in place.
--
-- BEGIN;
-- DO $$
-- DECLARE r record;
-- BEGIN
--   FOR r IN
--     SELECT tgrelid::regclass::text AS tbl
--     FROM pg_trigger
--     WHERE tgname = 'trg_company_tenant_sync' AND NOT tgisinternal
--   LOOP
--     EXECUTE format('DROP TRIGGER IF EXISTS trg_company_tenant_sync ON %s', r.tbl);
--   END LOOP;
--   FOR r IN
--     SELECT table_name::text AS table_name
--     FROM information_schema.columns
--     WHERE table_schema = 'public' AND column_name = 'company_id' AND table_name <> 'companies'
--   LOOP
--     EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS company_id', r.table_name);
--   END LOOP;
-- END;
-- $$;
-- DROP TRIGGER IF EXISTS trg_accounts_company_sync ON accounts;
-- DROP FUNCTION IF EXISTS sync_company_from_account();
-- DROP FUNCTION IF EXISTS sync_company_tenant_columns();
-- DROP TABLE IF EXISTS companies;
-- COMMIT;
-- ROLLBACK SCRIPT END
