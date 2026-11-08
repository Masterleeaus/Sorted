#!/bin/bash

export PATH="/home/admin/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"

cd /home/admin/apps/ai-fsm

set -a
source /home/admin/apps/ai-fsm/.env
set +a

export NODE_ENV=production
export HOSTNAME=127.0.0.1
export PORT=3000

echo "Starting AI-FSM with:"
node --version
which node

cd /home/admin/apps/ai-fsm/apps/web

exec /home/admin/.nvm/versions/node/v20.20.2/bin/node \
  /home/admin/apps/ai-fsm/apps/web/node_modules/next/dist/bin/next \
  start \
  --hostname 127.0.0.1 \
  --port 3000
