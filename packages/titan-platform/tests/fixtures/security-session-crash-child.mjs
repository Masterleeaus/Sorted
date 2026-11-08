import { tsImport } from 'tsx/esm/api';
import { createIdentitySessionRegistry } from '../../.test-dist/security-boundary.js';
const { createSqliteStorage } = await tsImport('@titan-zero/storage', { parentURL: import.meta.url, tsconfig: false });
const storage = createSqliteStorage(process.argv[2]);
const registry = await createIdentitySessionRegistry({ storage, storage_role: 'GLOBAL_REGISTRY' });
if (process.argv[3] === 'committed') {
  await registry.revokeSession('session-1', 1);
  process.send('ready');
  setInterval(() => {}, 1_000);
} else {
  await storage.transaction(async tx => {
    await tx.query('UPDATE titan_security_sessions SET revoked=1,revision=2 WHERE session_id=$1', ['session-1']);
    process.send('ready');
    await new Promise(() => { setInterval(() => {}, 1_000); });
  });
}
