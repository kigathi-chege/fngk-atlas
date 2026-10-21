import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.ATLAS_PORT) || 4317;
const host = process.env.ATLAS_HOST || (process.env.DOCKER_CONTAINER === '1' ? '0.0.0.0' : '127.0.0.1');
// A stray rejection (for example a filesystem call that failed after its
// request was gone) must be logged, never take the whole server down.
process.on('unhandledRejection', reason => { console.error('[atlas] unhandled rejection', reason); });
const app = await createApp({ root, dbPath: process.env.ATLAS_DB, logger: true });
await app.listen({ host, port });

// Close Device Sessions, terminals, and stores on shutdown; otherwise each stop
// leaves orphaned shells live on remote Devices.
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  if (closing) return;
  closing = true;
  const forced = setTimeout(() => process.exit(1), 10_000);
  forced.unref();
  void app.close().then(() => process.exit(0), () => process.exit(1));
});
