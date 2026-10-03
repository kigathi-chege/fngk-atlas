import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('Atlas production build', () => {
  it('assigns heavyweight editor and graph dependencies to lazy vendor chunks', async () => {
    const config = await readFile(path.join(root, 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/manualChunks/);
    expect(config).toMatch(/atlas-editor/);
    expect(config).toMatch(/atlas-graph/);
    expect(config).toMatch(/chunkSizeWarningLimit:\s*600/);
  });

  it('keeps browser acceptance within one renderer budget on modest CI hosts', async () => {
    const config = await readFile(path.join(root, 'playwright.config.ts'), 'utf8');
    expect(config).toMatch(/workers:\s*1/);
  });
});
