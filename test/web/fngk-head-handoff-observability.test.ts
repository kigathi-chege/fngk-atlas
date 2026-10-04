import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('FNGK handoff observability', () => {
  it('records prepare, install, and stop outcomes without leaking handoff details', async () => {
    const source = await readFile(resolve(root, 'src/web/components/FngkHeadHandoffPanel.svelte'), 'utf8');

    expect(source).toContain("import {atlasEvents}");
    expect(source).toContain("type:'fngk.handoff.prepare'");
    expect(source).toContain("type:'fngk.handoff.install'");
    expect(source).toContain("type:'fngk.handoff.stop'");
    expect(source).toContain('atlasEvents.resolve');
    expect(source).toContain('atlasEvents.fail');
    expect(source).not.toContain('metadata:{handoff');
  });
});
