#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT="${FSM_DEPLOY_ROOT:-/opt/business/ai-fsm}"
PROXY_NETWORK="${PROXY_NETWORK:-business_proxy}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_TARGET="${DEPLOY_ROOT}/env/.env"

sudo mkdir -p \
  "${DEPLOY_ROOT}/repo" \
  "${DEPLOY_ROOT}/env" \
  "${DEPLOY_ROOT}/data/postgres" \
  "${DEPLOY_ROOT}/data/uploads" \
  "${DEPLOY_ROOT}/backups" \
  "${DEPLOY_ROOT}/backups/status" \
  "${DEPLOY_ROOT}/logs" \
  "${DEPLOY_ROOT}/scripts"

sudo chown -R "${USER}:${USER}" "${DEPLOY_ROOT}"

if [[ ! -f "${ENV_TARGET}" ]]; then
  cp "${REPO_ROOT}/infra/garonhome.env.example" "${ENV_TARGET}"
  chmod 600 "${ENV_TARGET}"
  echo "created ${ENV_TARGET} from infra/garonhome.env.example"
else
  echo "env file already exists at ${ENV_TARGET}"
fi

if ! docker network inspect "${PROXY_NETWORK}" >/dev/null 2>&1; then
  docker network create "${PROXY_NETWORK}"
  echo "created docker network ${PROXY_NETWORK}"
else
  echo "docker network ${PROXY_NETWORK} already exists"
fi

cat <<EOF
Next steps:
1. Clone or copy the repo into ${DEPLOY_ROOT}/repo
2. Edit ${ENV_TARGET}
3. Connect nginx-proxy-manager to ${PROXY_NETWORK} if you want internal-only routing:
   docker network connect ${PROXY_NETWORK} nginx-proxy-manager
4. Configure backup.passphrase outside the backup directory and save the key in a password manager.
5. Configure backup monitoring cron/systemd for scripts/healthcheck-garonhome.sh;
   an incomplete or stale backup causes an exit code of 1 and a notification attempt.
6. After first deployment, run scripts/backup-garonhome.sh and confirm
   scripts/check-backup-health.mjs exits 0 before treating the system as backed up.
EOF
