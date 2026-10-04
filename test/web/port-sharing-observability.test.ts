import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('Port sharing observability', () => {
  it('records scan, publish, and stop outcomes with no public URL metadata', async () => {
    const source = await readFile(resolve(root, 'src/web/components/PortSharingPanel.svelte'), 'utf8');

    expect(source).toContain("import {atlasEvents}");
    expect(source).toContain("type:'port.scan'");
    expect(source).toContain("type:'port.publish'");
    expect(source).toContain("type:'port.stop'");
    expect(source).toContain('atlasEvents.resolve');
    expect(source).toContain('atlasEvents.fail');
    expect(source).not.toContain('metadata:{url');
  });
});
