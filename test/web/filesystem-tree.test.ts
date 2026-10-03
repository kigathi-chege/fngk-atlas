import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('FilesystemTree navigation contract', () => {
  it('only cancels a superseded request for the same directory', async () => {
    const source = await readFile(resolve(root, 'src/web/components/FilesystemTree.svelte'), 'utf8');
    expect(source).toContain('requestControllers=new Map<string,AbortController>()');
    expect(source).toContain('requestControllers.get(normalized)?.abort()');
    expect(source).toContain('signal:controller.signal');
    expect(source).toContain('requestGenerations.get(normalized)===token');
    expect(source).toContain('abortFileRequests()');
  });

  it('tracks loading per directory and clears stale indicators after a context change', async () => {
    const source = await readFile(resolve(root, 'src/web/components/FilesystemTree.svelte'), 'utf8');
    expect(source).toContain('pendingPaths=new Set<string>()');
    expect(source).toContain('pendingPaths.has(key(item.path))');
    expect(source).toContain('pendingPaths=new Set()');
    expect(source).toContain('<LoadingSpinner');
  });

  it('only calls the initial filesystem load from the immediate state subscription', async () => {
    const source = await readFile(resolve(root, 'src/web/components/FilesystemTree.svelte'), 'utf8');
    expect(source).toContain('state.subscribe(value=>');
    expect(source).not.toContain("void load(root);return()=>");
    expect(source).toContain('let initialLoad=true');
    expect(source).toContain('if(initialLoad||value.contextId!==contextId)');
  });

  it('does not call an interrupted root request an empty directory', async () => {
    const source = await readFile(resolve(root, 'src/web/components/FilesystemTree.svelte'), 'utf8');
    expect(source).toContain('loadedPaths=new Set<string>()');
    expect(source).toContain('loadedPaths.add(normalized)');
    expect(source).toContain('loadedPaths.has(root)&&!visibleRows.length');
  });
});
