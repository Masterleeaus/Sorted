# Deploy Titan Go / Field UI Redesign v3

The patch archive is rooted at `apps/...` and is designed to overlay `/home/admin/apps/ai-fsm`.

## 1. Copy the patch to the server

Example destination:

```bash
/home/admin/titan-go-field-ui-redesign-v3.zip
```

## 2. Backup the current working web source

```bash
cd /home/admin/apps/ai-fsm
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p /home/admin/backups

tar \
  --exclude='apps/web/node_modules' \
  --exclude='apps/web/.next' \
  -czf "/home/admin/backups/titan-field-before-ui-v3-$STAMP.tar.gz" \
  apps/web
```

## 3. Overlay the patch

```bash
cd /home/admin/apps/ai-fsm
unzip -o /home/admin/titan-go-field-ui-redesign-v3.zip
chown -R admin:admin apps/web
```

The ZIP also contains `CHANGES.md`, `DEPLOY.md`, `UI-AUDIT.md` and `FILE-LIST.txt` at its root; those can remain outside the application tree.

## 4. Run the cheap validation first

```bash
su - admin -c '
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
export NODE_OPTIONS="--max-old-space-size=3072"
cd /home/admin/apps/ai-fsm
pnpm --filter ./apps/web exec tsc --noEmit
'
```

If TypeScript reports an error, stop there and fix it before building.

## 5. Run one production build

```bash
su - admin -c '
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
export NODE_OPTIONS="--max-old-space-size=3072"
cd /home/admin/apps/ai-fsm
pnpm --filter ./apps/web build
'
```

Do not run parallel builds on this VPS.

## 6. Restart once

```bash
systemctl restart ai-fsm
sleep 5
systemctl is-active ai-fsm
curl -sS http://127.0.0.1:3000/api/health
echo
```

## 7. PWA refresh

Titan Go explicitly checks for a newer service worker, but iPadOS can keep an already-open PWA process alive. After deployment, fully close Titan Go and reopen it. If an old shell persists, open the site in Safari once and reload before reopening the installed PWA.

## Important preserved behaviour

- Existing auth/session flow is retained.
- Existing PostgreSQL/RLS Settings fix is retained.
- Titan workforce native API routes are not removed.
- The SQLite-only donor Zero production runtime is **not** re-enabled. Zero execution remains fail-closed until the PostgreSQL runtime adapter is completed.
- Non-Field Desk/Pay backend routes are preserved; they are simply removed from the primary Field product navigation.
