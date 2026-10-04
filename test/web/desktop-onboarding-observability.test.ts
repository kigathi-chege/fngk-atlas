import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('Desktop onboarding observability', () => {
  it('records local FNGK convergence and sign-in outcomes without origin metadata', async () => {
    const source = await readFile(resolve(root, 'src/web/components/DesktopOnboarding.svelte'), 'utf8');

    expect(source).toContain("import {atlasEvents}");
    expect(source).toContain("type:'onboarding.converge'");
    expect(source).toContain("type:'onboarding.login'");
    expect(source).toContain('atlasEvents.resolve');
    expect(source).toContain('atlasEvents.fail');
    expect(source).not.toContain('metadata:{origin');
  });
});
