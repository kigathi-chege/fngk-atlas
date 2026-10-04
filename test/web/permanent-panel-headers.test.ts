import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const component = (name: string) => readFile(resolve(root, `src/web/components/${name}.svelte`), 'utf8');

describe('permanent panel headers', () => {
  it('uses one reusable header contract across retained workspace regions', async () => {
    expect(await component('PermanentPanelHeader')).toContain('atlas-permanent-header');
    for (const name of ['WorkspacePanel', 'DevicesPanel', 'DeviceDetailsPanel', 'FilesystemTree', 'DetailsPanel']) {
      expect(await component(name)).toContain("PermanentPanelHeader");
    }
  });
});
