import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('remote filesystem refresh', () => {
  it('passes an explicit force query through to the device-session filesystem cache', async () => {
    const source = await readFile(resolve(root, 'src/server/app.ts'), 'utf8');
    expect(source).toContain('force?: string;');
    expect(source).toContain("force: query.force === '1'");
  });
});
