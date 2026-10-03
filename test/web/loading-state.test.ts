import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('Atlas loading components', () => {
  it('provides accessible reduced-motion-safe loading primitives', async () => {
    const [spinner, state] = await Promise.all([
      readFile(resolve(root, 'src/web/components/LoadingSpinner.svelte'), 'utf8'),
      readFile(resolve(root, 'src/web/components/LoadingState.svelte'), 'utf8'),
    ]);
    expect(spinner).toContain('prefers-reduced-motion');
    expect(state).toContain('role="status"');
  });
});
