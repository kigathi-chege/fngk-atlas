import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('App connection observability', () => {
  it('tracks Calculator connect and disconnect without recording integration URLs', async () => {
    const source = await readFile(resolve(root, 'src/web/components/AppConnectionsPanel.svelte'), 'utf8');

    expect(source).toContain("import {atlasEvents}");
    expect(source).toContain("type:'app.connection'");
    expect(source).toContain('atlasEvents.begin');
    expect(source).toContain('atlasEvents.resolve');
    expect(source).toContain('atlasEvents.fail');
    expect(source).not.toContain('metadata:{origin');
  });
});
