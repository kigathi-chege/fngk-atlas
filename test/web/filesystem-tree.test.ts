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

  it('labels an empty tree as a successful empty route rather than a cancellation', async () => {
    const source = await readFile(resolve(root, 'src/web/components/FilesystemTree.svelte'), 'utf8');
    expect(source).toContain('loadedPaths.add(normalized)');
    expect(source).toContain('route?.id');
    expect(source).toContain('No filesystem entries returned');
  });

  it('asks the server to bypass a stale directory cache on refresh', async () => {
    const source = await readFile(resolve(root, 'src/web/components/FilesystemTree.svelte'), 'utf8');
    expect(source).toContain("const forceQuery=force?'&force=1':''");
    expect(source).toContain('limit=500${forceQuery}');
  });

  it('records only safe route and session correlation for a completed remote listing', async () => {
    const source = await readFile(resolve(root, 'src/web/components/FilesystemTree.svelte'), 'utf8');
    expect(source).toContain('correlationId:page.diagnostics?.sessionId');
    expect(source).toContain("metadata:{route:page.route?.id");
  });

  it('publishes real load outcomes but silences superseded requests', async () => {
    const source = await readFile(resolve(root, 'src/web/components/FilesystemTree.svelte'), 'utf8');
    expect(source).toContain("import {atlasEvents}");
    expect(source).toContain("type:'filesystem.list'");
    expect(source).toContain('atlasEvents.resolve(eventId');
    expect(source).toContain('atlasEvents.fail(eventId');
    expect(source).toContain('atlasEvents.removeLocal(eventId');
    expect(source).not.toContain('atlasEvents.cancel(eventId');
  });
});
