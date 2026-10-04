import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('Deployment observability', () => {
  it('publishes deployment lifecycle outcomes without retaining deployment payloads', async () => {
    const source = await readFile(resolve(root, 'src/web/components/DeploymentPanel.svelte'), 'utf8');
    expect(source).toContain("import {atlasEvents}");
    expect(source).toContain("type:'deployment'");
    expect(source).toContain('atlasEvents.begin');
    expect(source).toContain('atlasEvents.resolve');
    expect(source).toContain('atlasEvents.fail');
    expect(source).not.toContain('metadata:{review');
  });
});
