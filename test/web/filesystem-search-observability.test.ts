import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('Filesystem search observability', () => {
  it('records only real failures, never superseded searches or search terms', async () => {
    const source = await readFile(resolve(root, 'src/web/components/FilesystemTree.svelte'), 'utf8');
    expect(source).toContain("type:'filesystem.search'");
    expect(source).toContain('Search filesystem');
    expect(source).toContain('atlasEvents.fail(eventId');
    expect(source).not.toContain('Superseded by a newer filesystem search');
    expect(source).not.toContain('metadata:{query');
  });
});
