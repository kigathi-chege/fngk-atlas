import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.ATLAS_PORT) || 4317;
const host = process.env.ATLAS_HOST || (process.env.DOCKER_CONTAINER === '1' ? '0.0.0.0' : '127.0.0.1');
const app = await createApp({ root, dbPath: process.env.ATLAS_DB, logger: true });
await app.listen({ host, port });
