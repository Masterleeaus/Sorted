import { IdentitySessionRegistry } from '../../.test-dist/security-boundary.js';
import { tsImport } from 'tsx/esm/api';
const { createSqliteStorage } = await tsImport('@titan-zero/storage', { parentURL: import.meta.url, tsconfig: false });
const storage = createSqliteStorage(process.argv[2]);
const registry = new IdentitySessionRegistry(storage);
process.send?.({ type: 'ready' });
process.once('message', async message => {
  if (message?.type !== 'revoke') return;
  process.send?.({ type: 'attempting' });
  try {
    await registry.revokeSession(message.session_id, Number(message.revision));
    process.send?.({ type: 'done' });
    process.exitCode = 0;
  } catch (error) {
    process.send?.({ type: 'error', message: error instanceof Error ? error.message : 'unknown' });
    process.exitCode = 1;
  } finally {
    await storage.close();
  }
});
