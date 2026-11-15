#!/usr/bin/env bash
set -euo pipefail

cp -n .env.example .env || true
pnpm install
docker compose -f infra/compose.dev.yml up -d postgres
: "${DEV_DB_PASSWORD:?Set DEV_DB_PASSWORD to the local dev Postgres password (the POSTGRES_PASSWORD used by infra/compose.dev.yml)}"
export PGPASSWORD="$DEV_DB_PASSWORD"
export DATABASE_URL=${DATABASE_URL:-postgresql://ai_fsm@localhost:5432/ai_fsm}
MIGRATION_DATABASE_URL="$DATABASE_URL" pnpm db:migrate || true

echo "bootstrap complete"
