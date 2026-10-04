import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('File editor observability', () => {
  it('records save outcomes without persisting file paths or contents in event metadata', async () => {
    const source = await readFile(resolve(root, 'src/web/components/FilePanel.svelte'), 'utf8');

    expect(source).toContain("import {atlasEvents}");
    expect(source).toContain("type:'file.save'");
    expect(source).toContain('atlasEvents.begin');
    expect(source).toContain('atlasEvents.resolve');
    expect(source).toContain('atlasEvents.fail');
    expect(source).not.toContain('metadata:{path');
    expect(source).not.toContain('metadata:{content');
  });
});
