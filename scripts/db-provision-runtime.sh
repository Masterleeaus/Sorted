#!/usr/bin/env bash
# Provision a restricted runtime database role. Run AFTER migrations, once per role.
# Does not switch running services; point each service's DATABASE_URL at its role
# in the deployment env (see infra/garonhome.env.example and docs/working/rls-web-tier-flip.md).
#
# Roles (security model: ai/INVARIANTS.md, docs/working/rls-web-tier-flip.md):
#   ai_fsm_web     NOSUPERUSER NOBYPASSRLS. Web tier. RLS is enforced for every
#                  query that runs under this role.
#   ai_fsm_worker  NOSUPERUSER BYPASSRLS. Worker tier: trusted cross-account sweeps
#                  (migration 185). Bypass is the only privilege above web, and it
#                  is limited to this role by the checks below. No DDL, no
#                  ownership, no role membership, no function grants beyond defaults.
#
# Required env:
#   RUNTIME_DB_PASSWORD   password for the role (never commit it)
#   RUNTIME_DB_ROLE       ai_fsm_web (default) or ai_fsm_worker
# Connection (one of):
#   MIGRATION_DATABASE_URL  admin URL reachable from this host (host psql or docker run --network host)
#   PROVISION_VIA_COMPOSE=1 run psql inside the postgres compose service instead. Needed on
#                           garonhome, where postgres has no host port. Requires FSM_ENV_FILE,
#                           FSM_COMPOSE_FILE, POSTGRES_USER, POSTGRES_DB.
set -euo pipefail
: "${RUNTIME_DB_PASSWORD:?RUNTIME_DB_PASSWORD is required}"
export RUNTIME_DB_ROLE="${RUNTIME_DB_ROLE:-ai_fsm_web}"
[[ "$RUNTIME_DB_ROLE" == ai_fsm_web || "$RUNTIME_DB_ROLE" == ai_fsm_worker ]] || {
  echo 'RUNTIME_DB_ROLE must be ai_fsm_web or ai_fsm_worker' >&2
  exit 1
}
if [[ "${PROVISION_VIA_COMPOSE:-0}" == 1 ]]; then
  : "${FSM_ENV_FILE:?FSM_ENV_FILE is required with PROVISION_VIA_COMPOSE=1}"
  : "${FSM_COMPOSE_FILE:?FSM_COMPOSE_FILE is required with PROVISION_VIA_COMPOSE=1}"
  : "${POSTGRES_USER:?POSTGRES_USER is required with PROVISION_VIA_COMPOSE=1}"
  : "${POSTGRES_DB:?POSTGRES_DB is required with PROVISION_VIA_COMPOSE=1}"
else
  : "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}"
fi

psql_cmd() {
  if [[ "${PROVISION_VIA_COMPOSE:-0}" == 1 ]]; then
    docker compose --env-file "$FSM_ENV_FILE" -f "$FSM_COMPOSE_FILE" exec -T \
      -e RUNTIME_DB_ROLE="$RUNTIME_DB_ROLE" -e RUNTIME_DB_PASSWORD="$RUNTIME_DB_PASSWORD" \
      postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
  elif command -v psql >/dev/null; then
    psql "$MIGRATION_DATABASE_URL" "$@"
  else
    docker run --rm -i --network host -e RUNTIME_DB_ROLE -e RUNTIME_DB_PASSWORD \
      postgres:16 psql "$MIGRATION_DATABASE_URL" "$@"
  fi
}

psql_cmd -X -q -v ON_ERROR_STOP=1 <<'SQL'
\getenv runtime_role RUNTIME_DB_ROLE
\getenv runtime_password RUNTIME_DB_PASSWORD
BEGIN;
-- Create with the bypass attribute the role is designed for. Existing roles are
-- never altered here: the check below refuses a role whose attributes differ.
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION %s',
              :'runtime_role',
              CASE WHEN :'runtime_role' = 'ai_fsm_worker' THEN 'BYPASSRLS' ELSE 'NOBYPASSRLS' END)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'runtime_role') \gexec
SELECT set_config('provision.runtime_role', :'runtime_role', true) \g /dev/null
-- Refuse to repurpose an owner/admin identity or a role inheriting other roles.
-- Only ai_fsm_worker may carry BYPASSRLS; ai_fsm_web must not.
DO $$
DECLARE
  r pg_roles;
  want_bypass boolean := current_setting('provision.runtime_role') = 'ai_fsm_worker';
BEGIN
  SELECT * INTO STRICT r FROM pg_roles WHERE rolname = current_setting('provision.runtime_role');
  IF r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
     OR r.rolbypassrls <> want_bypass
     OR EXISTS (SELECT FROM pg_auth_members WHERE member = r.oid)
     OR EXISTS (SELECT FROM pg_class WHERE relowner = r.oid)
     OR EXISTS (SELECT FROM pg_namespace WHERE nspowner = r.oid)
     OR EXISTS (SELECT FROM pg_database WHERE datdba = r.oid) THEN
    RAISE EXCEPTION 'Runtime role % has attributes or ownership outside its model (bypassrls must be %)',
      r.rolname, want_bypass;
  END IF;
END $$;
ALTER ROLE :"runtime_role" LOGIN PASSWORD :'runtime_password';
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'runtime_role') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"runtime_role";
-- No schema CREATE, TRUNCATE, REFERENCES, migration-table or non-RLS table grants.
-- Both roles get the same DML set on RLS tables; the worker's only extra privilege is
-- BYPASSRLS. Per-table narrowing for the worker is a follow-up (see the flip runbook).
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO %I', c.relname, :'runtime_role')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity \gexec
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO :"runtime_role";
-- Login-only SECURITY DEFINER lookups are granted to the web role only.
SELECT format('GRANT EXECUTE ON FUNCTION public.app_login_candidates(text) TO %I', :'runtime_role')
WHERE :'runtime_role' = 'ai_fsm_web' \gexec
SELECT format('GRANT EXECUTE ON FUNCTION public.portal_job_report_account(uuid) TO %I', :'runtime_role')
WHERE :'runtime_role' = 'ai_fsm_web' \gexec
-- Token resolvers (migration 204): bounded pre-account lookups, web role only.
SELECT format('GRANT EXECUTE ON FUNCTION public.%s TO %I', fn, :'runtime_role')
FROM (VALUES
  ('resolve_portal_client_account(uuid)'),
  ('resolve_estimate_share_account(uuid)'),
  ('resolve_invoice_share_account(uuid)'),
  ('resolve_open_intake_invite(uuid)'),
  ('resolve_intake_invite_state(uuid)'),
  ('resolve_square_location_settings(text)'),
  ('resolve_owner_account_id()'),
  ('resolve_visit_candidate_account(uuid)'),
  ('consume_portal_magic_link(uuid)'),
  ('consume_portal_email_change(uuid)')
) AS t(fn)
WHERE :'runtime_role' = 'ai_fsm_web' \gexec
COMMIT;
-- Verification: print the attributes the owner should see before wiring the URL.
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
FROM pg_roles WHERE rolname = :'runtime_role';
SQL
echo "Provisioned restricted ${RUNTIME_DB_ROLE}; runtime connection settings were not changed."
