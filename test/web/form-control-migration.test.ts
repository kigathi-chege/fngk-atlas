import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('shared form control migration', () => {
  it('uses AtlasInput for filesystem search, file naming, and onboarding origin entry', async () => {
    const filesystem = await readFile(resolve(root, 'src/web/components/FilesystemTree.svelte'), 'utf8');
    const onboarding = await readFile(resolve(root, 'src/web/components/DesktopOnboarding.svelte'), 'utf8');

    expect(filesystem).toContain("import AtlasInput from './ui/AtlasInput.svelte'");
    expect(filesystem.match(/<AtlasInput/g)?.length).toBeGreaterThanOrEqual(3);
    expect(onboarding).toContain("import AtlasInput from './ui/AtlasInput.svelte'");
    expect(onboarding).toContain('<AtlasInput bind:value={origin}');
  });
});
