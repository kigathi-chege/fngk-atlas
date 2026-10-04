import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
describe('shared Atlas form controls', () => {
  it('ships one styled input, select, textarea, and searchable combobox contract', async () => {
    for (const file of ['AtlasInput.svelte', 'AtlasSelect.svelte', 'AtlasTextarea.svelte', 'AtlasCombobox.svelte']) {
      await expect(readFile(resolve(root, `src/web/components/ui/${file}`), 'utf8')).resolves.toContain('atlas-');
    }
    await expect(readFile(resolve(root, 'src/web/components/ui/form-controls.css'), 'utf8')).resolves.toContain('.atlas-combobox');
  });

  it('preserves native constraints required by reusable device-profile inputs', async () => {
    const input = await readFile(resolve(root, 'src/web/components/ui/AtlasInput.svelte'), 'utf8');
    expect(input).toContain('export let maxlength');
    expect(input).toContain('{maxlength}');
  });
});
