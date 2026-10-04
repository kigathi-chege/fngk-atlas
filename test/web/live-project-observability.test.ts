import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('Live project observability', () => {
  it('records a stop request and its outcome without recording route payloads', async () => {
    const source = await readFile(resolve(root, 'src/web/components/LiveProjectPanel.svelte'), 'utf8');
    expect(source).toContain("import {atlasEvents}");
    expect(source).toContain("type:'live-project'");
    expect(source).toContain('atlasEvents.begin');
    expect(source).toContain('atlasEvents.resolve');
    expect(source).toContain('atlasEvents.fail');
  });
});
