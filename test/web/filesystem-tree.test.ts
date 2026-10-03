import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('FilesystemTree navigation contract', () => {
  it('cancels an in-flight directory request before navigating to the next path', async () => {
    const source = await readFile(resolve(root, 'src/web/components/FilesystemTree.svelte'), 'utf8');
    expect(source).toContain('navigationController?.abort()');
    expect(source).toContain('signal:navigationController.signal');
  });

  it('tracks loading per directory and clears stale indicators after a context change', async () => {
    const source = await readFile(resolve(root, 'src/web/components/FilesystemTree.svelte'), 'utf8');
    expect(source).toContain('pendingPaths=new Set<string>()');
    expect(source).toContain('pendingPaths.has(key(item.path))');
    expect(source).toContain('pendingPaths=new Set()');
    expect(source).toContain('<LoadingSpinner');
  });
});
